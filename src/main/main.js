const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SerialPort } = require('serialport');
const { Client } = require('ssh2');
const pty = require('@lydell/node-pty');

let win = null;
const sessions = new Map(); // id -> { write, resize, close }
const pendingConnects = new Map(); // connectId -> abort fn
let nextSessionId = 1;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    title: 'CooTerm',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// Connection-attempt log line, routed to the popup by connectId
function clog(connectId, level, message) {
  if (connectId) send('session:log', { connectId, level, message });
}

/* ---------------- Host storage (userData/hosts.json) ---------------- */

const SECRET_FIELDS = ['password', 'passphrase'];
const ENC_PREFIX = 'enc:';

function hostsFile() {
  return path.join(app.getPath('userData'), 'hosts.json');
}

function protectSecrets(host) {
  const out = { ...host };
  if (!safeStorage.isEncryptionAvailable()) return out;
  for (const f of SECRET_FIELDS) {
    if (out[f] && !String(out[f]).startsWith(ENC_PREFIX)) {
      out[f] = ENC_PREFIX + safeStorage.encryptString(String(out[f])).toString('base64');
    }
  }
  return out;
}

function revealSecrets(host) {
  const out = { ...host };
  for (const f of SECRET_FIELDS) {
    if (out[f] && String(out[f]).startsWith(ENC_PREFIX)) {
      try {
        out[f] = safeStorage.decryptString(Buffer.from(String(out[f]).slice(ENC_PREFIX.length), 'base64'));
      } catch {
        out[f] = '';
      }
    }
  }
  return out;
}

ipcMain.handle('hosts:load', () => {
  const file = hostsFile();
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw).map(revealSecrets);
  } catch (err) {
    // Don't leave a corrupt file in place — the next save would silently
    // replace whatever data it still holds. Keep it for manual recovery.
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
    return [];
  }
});

ipcMain.handle('hosts:save', (e, hosts) => {
  const file = hostsFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(hosts.map(protectSecrets), null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return true;
});

/* ---------------- Serial ---------------- */

ipcMain.handle('ports:list', async () => {
  try {
    return await SerialPort.list();
  } catch (err) {
    return [];
  }
});

function createSerialSession(id, cfg) {
  const cid = cfg.connectId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = err => {
      if (settled) return;
      settled = true;
      pendingConnects.delete(cid);
      err ? reject(err) : resolve();
    };

    const baud = parseInt(cfg.baudRate, 10) || 115200;
    const dataBits = parseInt(cfg.dataBits, 10) || 8;
    const parity = cfg.parity || 'none';
    const stopBits = parseFloat(cfg.stopBits) || 1;

    clog(cid, 'info', `Opening ${cfg.path} at ${baud} baud (${dataBits}${parity[0].toUpperCase()}${stopBits}, flow control: ${cfg.flow || 'none'})`);

    const port = new SerialPort({
      path: cfg.path,
      baudRate: baud,
      dataBits,
      stopBits,
      parity,
      rtscts: cfg.flow === 'rtscts',
      xon: cfg.flow === 'xonxoff',
      xoff: cfg.flow === 'xonxoff',
      autoOpen: false
    });

    pendingConnects.set(cid, () => {
      clog(cid, 'info', 'Cancelled by user');
      try { if (port.isOpen) port.close(); } catch {}
      finish(new Error('Cancelled by user'));
    });

    port.open(err => {
      if (settled) {
        if (!err) { try { port.close(); } catch {} }
        return;
      }
      if (err) {
        clog(cid, 'error', `Failed to open port: ${err.message}`);
        return finish(err);
      }
      clog(cid, 'debug', `OS handle acquired for ${cfg.path}`);
      clog(cid, 'info', 'Port opened');
      sessions.set(id, {
        write: data => port.write(data),
        resize: () => {},
        close: () => { try { if (port.isOpen) port.close(); } catch {} }
      });
      port.on('data', data => send('session:data', { id, data }));
      port.on('close', () => {
        sessions.delete(id);
        send('session:status', { id, status: 'closed' });
      });
      port.on('error', e2 => send('session:status', { id, status: 'error', message: e2.message }));
      finish();
    });
  });
}

/* ---------------- SSH ---------------- */

function createSshSession(id, cfg) {
  const cid = cfg.connectId;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let ready = false;
    let settled = false;
    const finish = err => {
      if (settled) return;
      settled = true;
      pendingConnects.delete(cid);
      err ? reject(err) : resolve();
    };

    pendingConnects.set(cid, () => {
      clog(cid, 'info', 'Cancelled by user');
      try { conn.end(); } catch {}
      finish(new Error('Cancelled by user'));
    });

    conn.on('greeting', g => clog(cid, 'info', `Server greeting: ${String(g).trim()}`));
    conn.on('banner', b => clog(cid, 'info', `Server banner: ${String(b).trim()}`));
    conn.on('handshake', neg => {
      try {
        clog(cid, 'info', `Handshake complete (kex: ${neg.kex}, host key: ${neg.srvHostKey}, cipher: ${neg.cs.cipher})`);
      } catch {
        clog(cid, 'info', 'Handshake complete');
      }
    });

    conn.on('ready', () => {
      if (settled) { try { conn.end(); } catch {} return; }
      clog(cid, 'info', 'Authentication succeeded');
      clog(cid, 'info', 'Opening shell...');
      conn.shell(
        { term: 'xterm-256color', cols: cfg.cols || 80, rows: cfg.rows || 24 },
        (err, stream) => {
          if (err) {
            clog(cid, 'error', `Failed to open shell: ${err.message}`);
            conn.end();
            return finish(err);
          }
          ready = true;
          clog(cid, 'info', 'Shell ready');
          sessions.set(id, {
            write: data => stream.write(data),
            resize: (cols, rows) => { try { stream.setWindow(rows, cols, 0, 0); } catch {} },
            close: () => { try { conn.end(); } catch {} }
          });
          stream.on('data', data => send('session:data', { id, data }));
          stream.stderr.on('data', data => send('session:data', { id, data }));
          stream.on('close', () => {
            sessions.delete(id);
            try { conn.end(); } catch {}
            send('session:status', { id, status: 'closed' });
          });
          finish();
        }
      );
    });

    conn.on('error', err => {
      if (!ready) {
        clog(cid, 'error', `Connection error: ${err.message}${err.level ? ` (${err.level})` : ''}`);
        finish(err);
      } else {
        send('session:status', { id, status: 'error', message: err.message });
      }
    });

    conn.on('close', () => {
      if (sessions.has(id)) {
        sessions.delete(id);
        send('session:status', { id, status: 'closed' });
      }
    });

    // Servers that use keyboard-interactive auth (common on network gear)
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, answer) => {
      clog(cid, 'info', 'Server requested keyboard-interactive authentication');
      answer(prompts.map(() => cfg.password || ''));
    });

    const opts = {
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 22,
      username: cfg.username,
      readyTimeout: 15000,
      keepaliveInterval: 30000,
      tryKeyboard: true,
      debug: msg => clog(cid, 'debug', msg)
    };

    if (cfg.auth === 'key' && cfg.keyPath) {
      clog(cid, 'info', `Using private key: ${cfg.keyPath}`);
      try {
        opts.privateKey = fs.readFileSync(cfg.keyPath);
      } catch (err) {
        clog(cid, 'error', `Cannot read key file: ${err.message}`);
        return finish(new Error(`Cannot read key file: ${err.message}`));
      }
      if (cfg.passphrase) opts.passphrase = cfg.passphrase;
    } else {
      opts.password = cfg.password || '';
    }

    clog(cid, 'info', `Connecting to ${opts.host}:${opts.port} as ${opts.username || '(no user)'}...`);
    try {
      conn.connect(opts);
    } catch (err) {
      clog(cid, 'error', err.message);
      finish(err);
    }
  });
}

/* ---------------- Local shell ---------------- */

function createLocalSession(id, cfg) {
  const cid = cfg.connectId;
  return new Promise((resolve, reject) => {
    const shell = cfg.shell || 'powershell.exe';
    clog(cid, 'info', `Starting ${shell}...`);
    let proc;
    try {
      proc = pty.spawn(shell, cfg.args || [], {
        name: 'xterm-256color',
        cols: cfg.cols || 80,
        rows: cfg.rows || 24,
        cwd: cfg.cwd || os.homedir(),
        env: process.env
      });
    } catch (err) {
      clog(cid, 'error', `Failed to start ${shell}: ${err.message}`);
      return reject(err);
    }
    sessions.set(id, {
      write: data => proc.write(data),
      resize: (cols, rows) => { try { if (cols > 0 && rows > 0) proc.resize(cols, rows); } catch {} },
      close: () => { try { proc.kill(); } catch {} }
    });
    proc.onData(data => send('session:data', { id, data: Buffer.from(data, 'utf8') }));
    proc.onExit(({ exitCode }) => {
      sessions.delete(id);
      send('session:status', { id, status: 'closed', message: `exit code ${exitCode}` });
    });
    resolve();
  });
}

/* ---------------- Session IPC ---------------- */

ipcMain.handle('session:create', async (e, cfg) => {
  const id = 's' + nextSessionId++;
  try {
    if (cfg.type === 'serial') await createSerialSession(id, cfg);
    else if (cfg.type === 'ssh') await createSshSession(id, cfg);
    else if (cfg.type === 'local') await createLocalSession(id, cfg);
    else throw new Error(`Unknown session type: ${cfg.type}`);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('session:input', (e, { id, data }) => {
  const s = sessions.get(id);
  if (s) s.write(data);
});

ipcMain.on('session:resize', (e, { id, cols, rows }) => {
  const s = sessions.get(id);
  if (s) s.resize(cols, rows);
});

ipcMain.on('session:cancelConnect', (e, connectId) => {
  const abort = pendingConnects.get(connectId);
  if (abort) abort();
});

ipcMain.handle('session:close', (e, id) => {
  const s = sessions.get(id);
  if (s) s.close();
  sessions.delete(id);
  return true;
});

/* ---------------- Misc ---------------- */

ipcMain.handle('dialog:openFile', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select private key',
    properties: ['openFile']
  });
  return res.canceled ? null : res.filePaths[0];
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const s of sessions.values()) s.close();
  sessions.clear();
  app.quit();
});
