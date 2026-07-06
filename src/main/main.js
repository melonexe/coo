const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
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

/* ---------------- Network config (IP / MAC changer) ---------------- */

const NET_CLASS_GUID = '{4d36e972-e325-11ce-bfc8-08002be10318}';

function runPS(psBody) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psBody],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
  });
}

// Run a PowerShell body elevated (UAC). The body should set $ok/$err and Log(...) lines;
// the wrapper writes a JSON result file we read back. Returns { ok, error, log[] }.
function runElevated(psBody) {
  return new Promise(resolve => {
    const tmp = app.getPath('temp');
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scriptFile = path.join(tmp, `cooterm-net-${stamp}.ps1`);
    const resultFile = path.join(tmp, `cooterm-net-${stamp}.json`);

    const wrapper =
      `$ErrorActionPreference = 'Stop'\n` +
      `$log = New-Object System.Collections.ArrayList\n` +
      `function Log($m){ [void]$log.Add([string]$m) }\n` +
      `$ok = $true; $err = ''\n` +
      `try {\n${psBody}\n} catch { $ok = $false; $err = $_.Exception.Message; Log("ERROR: $err") }\n` +
      `$r = [PSCustomObject]@{ ok = $ok; error = $err; log = @($log) }\n` +
      `$r | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath '${resultFile}' -Encoding UTF8\n`;

    fs.writeFileSync(scriptFile, wrapper, 'utf8');

    const launcher =
      `Start-Process powershell -ArgumentList ` +
      `'-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','"${scriptFile}"' ` +
      `-Verb RunAs -Wait`;

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcher],
      { windowsHide: true }
    );
    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    child.on('exit', () => {
      let result;
      try {
        const raw = fs.readFileSync(resultFile, 'utf8').replace(/^﻿/, '');
        result = JSON.parse(raw);
        if (result.log && !Array.isArray(result.log)) result.log = [result.log];
        if (!result.log) result.log = [];
      } catch {
        result = {
          ok: false,
          error: stderr.trim() || 'Elevation was cancelled or the operation did not complete.',
          log: []
        };
      }
      try { fs.unlinkSync(scriptFile); } catch {}
      try { fs.unlinkSync(resultFile); } catch {}
      resolve(result);
    });
  });
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function isIpv4(s) {
  const m = IPV4_RE.exec(String(s || '').trim());
  return !!m && m.slice(1).every(o => +o >= 0 && +o <= 255);
}
function normalizeMac(s) {
  const hex = String(s || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 12 ? hex : null;
}
function prefixToMask(prefix) {
  const p = parseInt(prefix, 10);
  if (!(p >= 0 && p <= 32)) return null;
  const octets = [0, 0, 0, 0];
  for (let i = 0; i < p; i++) octets[i >> 3] |= 1 << (7 - (i % 8));
  return octets.join('.');
}

ipcMain.handle('net:list', async () => {
  const ps = `
$out = Get-NetAdapter -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
  $a = $_
  $ip = Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254*' } | Select-Object -First 1
  $gw = (Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
         Select-Object -First 1).NextHop
  $dns = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty ServerAddresses)
  [PSCustomObject]@{
    name = $a.Name
    ifIndex = $a.ifIndex
    status = [string]$a.Status
    description = $a.InterfaceDescription
    mac = $a.MacAddress
    permanentMac = $a.PermanentAddress
    linkSpeed = [string]$a.LinkSpeed
    ip = $ip.IPAddress
    prefix = $ip.PrefixLength
    dhcp = ($ip.PrefixOrigin -eq 'Dhcp')
    gateway = $gw
    dns = $dns
  }
}
@($out) | ConvertTo-Json -Depth 4
`;
  try {
    const raw = await runPS(ps);
    let data = JSON.parse(raw.trim() || '[]');
    if (!Array.isArray(data)) data = [data];
    return { ok: true, interfaces: data };
  } catch (err) {
    return { ok: false, error: err.message, interfaces: [] };
  }
});

ipcMain.handle('net:apply', async (e, cfg) => {
  const errors = [];
  const name = String(cfg.ifName || '').replace(/["'`$]/g, '');
  if (!name) errors.push('No interface selected');
  const psIfn = name.replace(/'/g, "''");

  const parts = [`$ifn = '${psIfn}'`];
  let macRestart = false;

  // --- MAC (registry NetworkAddress, then adapter restart) ---
  if (cfg.macMode === 'custom' || cfg.macMode === 'random') {
    const mac = normalizeMac(cfg.mac);
    if (!mac) errors.push('Invalid MAC address (need 12 hex digits)');
    else {
      parts.push(macRegistryScript(`Set-ItemProperty -Path $sub.PSPath -Name NetworkAddress -Value '${mac}'; Log 'Set MAC to ${mac}'`));
      macRestart = true;
    }
  } else if (cfg.macMode === 'restore') {
    parts.push(macRegistryScript(`Remove-ItemProperty -Path $sub.PSPath -Name NetworkAddress -ErrorAction SilentlyContinue; Log 'Restored permanent MAC'`));
    macRestart = true;
  }

  if (macRestart) {
    parts.push(
      `Log 'Restarting adapter to apply MAC...'\n` +
      `Disable-NetAdapter -Name $ifn -Confirm:$false\n` +
      `Start-Sleep -Seconds 2\n` +
      `Enable-NetAdapter -Name $ifn -Confirm:$false\n` +
      `Start-Sleep -Seconds 3\n` +
      `Log 'Adapter restarted'`
    );
  }

  // --- IP ---
  if (cfg.ipMode === 'dhcp') {
    parts.push(nsh(`interface ip set address name="$ifn" source=dhcp`, 'Set IP to DHCP'));
    parts.push(nsh(`interface ip set dns name="$ifn" source=dhcp`, 'Set DNS to DHCP'));
  } else if (cfg.ipMode === 'static') {
    if (!isIpv4(cfg.ip)) errors.push('Invalid IP address');
    const mask = prefixToMask(cfg.prefix);
    if (!mask) errors.push('Invalid subnet prefix (0-32)');
    let gw = 'none';
    if (cfg.gateway && String(cfg.gateway).trim()) {
      if (!isIpv4(cfg.gateway)) errors.push('Invalid gateway');
      else gw = String(cfg.gateway).trim();
    }
    const dnsList = String(cfg.dns || '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    for (const d of dnsList) if (!isIpv4(d)) errors.push(`Invalid DNS server: ${d}`);

    if (!errors.length) {
      parts.push(nsh(`interface ip set address name="$ifn" source=static address=${cfg.ip} mask=${mask} gateway=${gw}`, 'Set static IP'));
      if (dnsList.length) {
        parts.push(nsh(`interface ip set dns name="$ifn" source=static address=${dnsList[0]} register=none`, 'Set primary DNS'));
        for (let i = 1; i < dnsList.length; i++) {
          parts.push(nsh(`interface ip add dns name="$ifn" address=${dnsList[i]} index=${i + 1}`, `Add DNS ${dnsList[i]}`));
        }
      }
    }
  }

  if (errors.length) return { ok: false, error: errors.join('; '), log: [] };
  if (parts.length === 1) return { ok: false, error: 'Nothing to change.', log: [] };

  return runElevated(parts.join('\n'));
});

function macRegistryScript(action) {
  return (
    `$ad = Get-NetAdapter -Name $ifn\n` +
    `$guid = $ad.InterfaceGuid\n` +
    `$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\${NET_CLASS_GUID}'\n` +
    `$sub = Get-ChildItem $base -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty -Path $_.PSPath -Name NetCfgInstanceId -ErrorAction SilentlyContinue).NetCfgInstanceId -eq $guid } | Select-Object -First 1\n` +
    `if (-not $sub) { throw 'Could not locate the registry key for this adapter' }\n` +
    `${action}`
  );
}

function nsh(cmd, label) {
  const safeLabel = label.replace(/'/g, "''");
  return (
    `$o = netsh ${cmd} 2>&1\n` +
    `Log ('${safeLabel}: ' + (($o | Out-String).Trim()))\n` +
    `if ($LASTEXITCODE -ne 0) { throw '${safeLabel} failed: ' + (($o | Out-String).Trim()) }`
  );
}

function netPresetsFile() {
  return path.join(app.getPath('userData'), 'net-presets.json');
}

ipcMain.handle('net:loadPresets', () => {
  try {
    if (!fs.existsSync(netPresetsFile())) return [];
    return JSON.parse(fs.readFileSync(netPresetsFile(), 'utf8'));
  } catch {
    return [];
  }
});

ipcMain.handle('net:savePresets', (e, presets) => {
  const file = netPresetsFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(presets, null, 2), 'utf8');
  fs.renameSync(tmp, file);
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
