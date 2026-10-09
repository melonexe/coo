// File access over an existing SSH session's connection.
//
// SFTP is used when the server offers it. Many small devices don't (no sftp-server
// binary, so the subsystem dies with exit code 127), so there is a fallback that
// needs nothing but a POSIX-ish shell: folders are listed and changed with
// ls / mkdir / mv / rm, and files are moved with scp when the host has it, or
// plain `cat` when it doesn't.
const path = require('path');
const fs = require('fs');

const SFTP_OPEN_TIMEOUT = 10000;
const COMMAND_TIMEOUT = 20000;

/* ---------------- Running commands on the host ---------------- */

// Quote a value for a POSIX shell
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function run(conn, command, { timeout = COMMAND_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, ch) => {
      if (err) return reject(err);
      const out = [];
      const errOut = [];
      let code = null;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { ch.close(); } catch {}
        reject(new Error('The host did not answer in time'));
      }, timeout);
      ch.on('data', d => out.push(d));
      ch.stderr.on('data', d => errOut.push(d));
      ch.on('exit', c => { code = c; });
      ch.on('close', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const raw = Buffer.concat(out);
        resolve({ code, raw, stdout: raw.toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8') });
      });
      ch.end();
    });
  });
}

// The last line a failed command printed is nearly always the reason
function failure(r, fallback) {
  const text = (r.stderr.trim() || r.stdout.trim()).split('\n').pop();
  return new Error(text || fallback || `Command failed with exit code ${r.code}`);
}

async function must(conn, command, fallback) {
  const r = await run(conn, command);
  if (r.code !== 0) throw failure(r, fallback);
  return r;
}

/* ---------------- Reading `ls -l` ---------------- */

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "Oct  9 11:02", "Oct  9  2025" or "2026-10-09 11:02" -> epoch seconds (0 if unknown)
function parseLsDate(text) {
  let m;
  if ((m = /^(\d{4})-(\d\d)-(\d\d)\s+(\d\d):(\d\d)/.exec(text))) {
    return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 1000);
  }
  if ((m = /^(\w{3})\s+(\d+)\s+(\d{4})$/.exec(text)) && m[1] in MONTHS) {
    return Math.floor(new Date(+m[3], MONTHS[m[1]], +m[2]).getTime() / 1000);
  }
  if ((m = /^(\w{3})\s+(\d+)\s+(\d\d):(\d\d)$/.exec(text)) && m[1] in MONTHS) {
    const now = new Date();
    const d = new Date(now.getFullYear(), MONTHS[m[1]], +m[2], +m[3], +m[4]);
    if (d.getTime() > now.getTime() + 86400000) d.setFullYear(d.getFullYear() - 1); // no year shown = within the last ~6 months
    return Math.floor(d.getTime() / 1000);
  }
  return 0;
}

const LS_LINE = /^([-dlbcpsDP])[-rwxsStT]{9}[.+@]?\s+\d+\s+\S+\s+\S+\s+(\d+(?:,\s*\d+)?)\s+(\w{3}\s+\d+\s+(?:\d{4}|\d\d:\d\d)|\d{4}-\d\d-\d\d\s+\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:\s+[+-]\d{4})?)\s(.*)$/;

function parseLs(text) {
  const entries = [];
  let unparsed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || /^total\s/.test(line)) continue;
    const m = LS_LINE.exec(line);
    if (!m) { unparsed++; continue; }
    const kind = m[1];
    let name = m[4];
    if (kind === 'l') {
      const arrow = name.indexOf(' -> ');
      if (arrow !== -1) name = name.slice(0, arrow);
    }
    if (name === '.' || name === '..') continue;
    entries.push({
      name,
      special: !'-dl'.includes(kind), // device, pipe, socket…
      type: kind === 'd' ? 'dir' : kind === 'l' ? 'link' : 'file',
      size: /^\d+$/.test(m[2]) ? +m[2] : 0,
      mtime: parseLsDate(m[3].trim()),
      link: kind === 'l'
    });
  }
  return { entries, unparsed };
}

const sortEntries = entries =>
  entries.sort((x, y) =>
    (x.type === 'dir' ? 0 : 1) - (y.type === 'dir' ? 0 : 1) ||
    x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));

/* ---------------- Transfers without SFTP ---------------- */

// Gives up on an scp that goes silent, so the transfer can fall back to cat
function stallTimer(onStall, ms = 20000) {
  let timer = setTimeout(onStall, ms);
  return {
    kick() { clearTimeout(timer); timer = setTimeout(onStall, ms); },
    stop() { clearTimeout(timer); }
  };
}

// scp "source" mode: the host sends "C<mode> <size> <name>\n", we acknowledge, it sends the bytes.
function scpDownload(conn, remote, local, onProgress) {
  return new Promise((resolve, reject) => {
    conn.exec(`scp -f -- ${q(remote)}`, (err, ch) => {
      if (err) return reject(err);
      const file = fs.createWriteStream(local);
      let stage = 'header';
      let pending = Buffer.alloc(0);
      let total = 0;
      let remaining = 0;
      let received = 0;
      let finished = false;
      let failed = null;
      const errOut = [];

      const fail = error => {
        if (failed || finished) return;
        failed = error;
        try { ch.close(); } catch {}
      };

      const watchdog = stallTimer(() => fail(new Error('scp stopped responding')));
      file.on('error', fail);
      ch.stderr.on('data', d => errOut.push(d));
      ch.write('\0'); // go ahead
      ch.on('data', chunk => {
        if (failed || finished) return;
        watchdog.kick();
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        for (;;) {
          if (stage === 'header') {
            const nl = pending.indexOf(0x0a);
            if (nl === -1) return;
            const line = pending.subarray(0, nl).toString('utf8');
            pending = pending.subarray(nl + 1);
            if (line[0] === '\x01' || line[0] === '\x02') return fail(new Error(line.slice(1).trim() || 'scp reported an error'));
            if (line[0] === 'T') { ch.write('\0'); continue; } // timestamps, not needed
            const m = /^C\d{4} (\d+) /.exec(line);
            if (!m) return fail(new Error(`Unexpected reply from scp: ${line.slice(0, 80)}`));
            total = remaining = +m[1];
            stage = remaining ? 'data' : 'tail';
            ch.write('\0');
          } else if (stage === 'data') {
            if (!pending.length) return;
            const part = pending.subarray(0, Math.min(pending.length, remaining));
            pending = pending.subarray(part.length);
            remaining -= part.length;
            received += part.length;
            if (!file.write(part)) { ch.pause(); file.once('drain', () => ch.resume()); }
            onProgress(received, null, total);
            if (!remaining) stage = 'tail';
          } else if (stage === 'tail') {
            if (!pending.length) return;
            if (pending[0] !== 0) return fail(new Error(pending.subarray(1).toString('utf8').trim() || 'scp reported an error'));
            finished = true;
            ch.write('\0');
            ch.end();
            return;
          }
        }
      });
      ch.on('close', () => {
        watchdog.stop();
        const error = failed || (finished ? null : new Error(Buffer.concat(errOut).toString('utf8').trim().split('\n').pop() || 'scp ended before the file arrived'));
        file.end(() => {
          if (!error) return resolve();
          fs.unlink(local, () => reject(error));
        });
      });
    });
  });
}

// scp "sink" mode: wait for the host's go-ahead, announce the file, send the bytes, wait for the verdict.
function scpUpload(conn, local, remote, size, onProgress) {
  return new Promise((resolve, reject) => {
    conn.exec(`scp -t -- ${q(remote)}`, (err, ch) => {
      if (err) return reject(err);
      let stage = 0; // 0: ready? 1: header accepted? 2: file accepted?
      let sent = 0;
      let finished = false;
      let failed = null;
      let reader = null;
      const errOut = [];

      const fail = error => {
        if (failed || finished) return;
        failed = error;
        if (reader) reader.destroy();
        try { ch.close(); } catch {}
      };

      const watchdog = stallTimer(() => fail(new Error('scp stopped responding')));
      ch.stderr.on('data', d => errOut.push(d));
      ch.on('data', chunk => {
        if (failed || finished) return;
        watchdog.kick();
        if (chunk[0] !== 0) return fail(new Error(chunk.subarray(1).toString('utf8').trim() || 'scp refused the file'));
        if (stage === 0) {
          stage = 1;
          ch.write(`C0644 ${size} ${path.basename(remote).replace(/[\r\n]/g, '_')}\n`);
        } else if (stage === 1) {
          stage = 2;
          reader = fs.createReadStream(local);
          reader.on('error', fail);
          reader.on('data', d => {
            sent += d.length;
            watchdog.kick();
            onProgress(sent, null, size);
            if (!ch.write(d)) { reader.pause(); ch.once('drain', () => reader.resume()); }
          });
          reader.on('end', () => ch.write('\0'));
        } else {
          finished = true;
          ch.end();
        }
      });
      ch.on('close', () => {
        watchdog.stop();
        if (finished && !failed) return resolve();
        reject(failed || new Error(Buffer.concat(errOut).toString('utf8').trim().split('\n').pop() || 'scp ended before the file was accepted'));
      });
    });
  });
}

// Last resort: `cat file` / `cat > file`. Works on anything with a shell.
function catDownload(conn, remote, local, size, onProgress) {
  return new Promise((resolve, reject) => {
    conn.exec(`cat -- ${q(remote)}`, (err, ch) => {
      if (err) return reject(err);
      const file = fs.createWriteStream(local);
      const errOut = [];
      let received = 0;
      let code = null;
      let failed = null;
      file.on('error', e => { failed = e; try { ch.close(); } catch {} });
      ch.stderr.on('data', d => errOut.push(d));
      ch.on('data', d => {
        received += d.length;
        if (!file.write(d)) { ch.pause(); file.once('drain', () => ch.resume()); }
        onProgress(received, null, size || 0);
      });
      ch.on('exit', c => { code = c; });
      ch.on('close', () => {
        const error = failed || (code === 0 ? null : new Error(Buffer.concat(errOut).toString('utf8').trim().split('\n').pop() || `cat failed with exit code ${code}`));
        file.end(() => {
          if (!error) return resolve();
          fs.unlink(local, () => reject(error));
        });
      });
      ch.end();
    });
  });
}

function catUpload(conn, local, remote, size, onProgress) {
  return new Promise((resolve, reject) => {
    conn.exec(`cat > ${q(remote)}`, (err, ch) => {
      if (err) return reject(err);
      const errOut = [];
      let sent = 0;
      let code = null;
      let failed = null;
      const reader = fs.createReadStream(local);
      reader.on('error', e => { failed = e; try { ch.close(); } catch {} });
      reader.on('data', d => {
        sent += d.length;
        onProgress(sent, null, size);
        if (!ch.write(d)) { reader.pause(); ch.once('drain', () => reader.resume()); }
      });
      reader.on('end', () => ch.end());
      ch.on('data', () => {}); // nothing expected, but keep the stream flowing
      ch.stderr.on('data', d => errOut.push(d));
      ch.on('exit', c => { code = c; });
      ch.on('close', () => {
        reader.destroy();
        if (!failed && code === 0) return resolve();
        reject(failed || new Error(Buffer.concat(errOut).toString('utf8').trim().split('\n').pop() || `cat failed with exit code ${code}`));
      });
    });
  });
}

// Read a whole stream into memory, giving up if it grows past `limit` or is cancelled
function collect(stream, abort, limit, onProgress, isCancelled, verdict = () => null, endEvent = 'end') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let got = 0;
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      abort(stream);
      reject(err);
    };
    stream.on('data', d => {
      if (settled) return;
      got += d.length;
      if (got > limit) return fail(new Error('The file is larger than the preview limit'));
      if (isCancelled()) return fail(new Error('Cancelled'));
      chunks.push(d);
      onProgress(got);
    });
    stream.on('error', fail);
    stream.on(endEvent, () => {
      if (settled) return;
      const err = verdict();
      if (err) return fail(err);
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

/* ---------------- The two backends ---------------- */

const call = (obj, fn, ...args) =>
  new Promise((resolve, reject) => obj[fn](...args, (err, res) => (err ? reject(err) : resolve(res))));

function sftpBackend(sftp) {
  return {
    mode: 'sftp',
    async list(dir) {
      const real = await call(sftp, 'realpath', dir || '.');
      const list = await call(sftp, 'readdir', real);
      const entries = await Promise.all(list.map(async item => {
        const a = item.attrs;
        let type = a.isDirectory() ? 'dir' : a.isSymbolicLink() ? 'link' : 'file';
        let size = a.size;
        if (type === 'link') {
          try {
            const target = await call(sftp, 'stat', path.posix.join(real, item.filename));
            if (target.isDirectory()) type = 'dir';
            else { type = 'file'; size = target.size; }
          } catch { type = 'file'; }
        }
        const special = !a.isDirectory() && !a.isSymbolicLink() && !a.isFile(); // device, pipe, socket…
        return { name: item.filename, type, size, mtime: a.mtime, link: a.isSymbolicLink(), special };
      }));
      return { dir: real, entries: sortEntries(entries) };
    },
    mkdir: target => call(sftp, 'mkdir', target),
    rename: (from, to) => call(sftp, 'rename', from, to),
    remove: (target, isDir) => call(sftp, isDir ? 'rmdir' : 'unlink', target),
    head(remote, limit) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        const stream = sftp.createReadStream(remote, { start: 0, end: limit - 1 });
        stream.on('data', d => chunks.push(d));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    },
    async size(remote) {
      return (await call(sftp, 'stat', remote)).size;
    },
    // Whole file into memory. Many small reads are kept in flight at once, which is far
    // quicker than reading front to back (the same idea as fastGet, but cancellable).
    async read(remote, limit, onProgress, isCancelled) {
      const size = (await call(sftp, 'stat', remote)).size;
      if (size > limit) throw new Error('The file is larger than the preview limit');
      const handle = await call(sftp, 'open', remote, 'r');
      try {
        const buf = Buffer.allocUnsafe(size);
        const CHUNK = 32768;
        const PARALLEL = 48;
        await new Promise((resolve, reject) => {
          let next = 0;
          let done = 0;
          let active = 0;
          let failed = false;
          const fail = err => { if (!failed) { failed = true; reject(err); } };
          const readExact = (offset, length, cb) => {
            sftp.read(handle, buf, offset, length, offset, (err, bytesRead) => {
              if (err) return cb(err);
              if (bytesRead >= length) return cb();
              if (!bytesRead) return cb(new Error('The file changed while it was being read'));
              readExact(offset + bytesRead, length - bytesRead, cb);
            });
          };
          const pump = () => {
            if (failed) return;
            if (done >= size) return resolve();
            while (active < PARALLEL && next < size) {
              if (isCancelled()) return fail(new Error('Cancelled'));
              const offset = next;
              const length = Math.min(CHUNK, size - offset);
              next += length;
              active++;
              readExact(offset, length, err => {
                active--;
                if (failed) return;
                if (err) return fail(err);
                done += length;
                onProgress(done);
                pump();
              });
            }
          };
          pump();
        });
        return buf;
      } finally {
        sftp.close(handle, () => {});
      }
    },
    async download(remote, local, size, onProgress) {
      await call(sftp, 'fastGet', remote, local, { step: onProgress });
      return 'SFTP';
    },
    async upload(local, remote, size, onProgress) {
      await call(sftp, 'fastPut', local, remote, { step: onProgress });
      return 'SFTP';
    }
  };
}

function shellBackend(session) {
  const conn = session.conn;

  // Is there an scp binary on the host? Asked once per session.
  async function hasScp() {
    if (session.hasScp === undefined) {
      try {
        const r = await run(conn, 'command -v scp >/dev/null 2>&1 || which scp >/dev/null 2>&1');
        session.hasScp = r.code === 0;
      } catch {
        session.hasScp = false;
      }
    }
    return session.hasScp;
  }

  return {
    mode: 'shell',
    note: session.fileNote,
    async list(dir) {
      const cd = `cd -- ${q(dir || '.')}`;
      let r = await run(conn, `${cd} && pwd && LC_ALL=C ls -lA`);
      if (r.code !== 0) {
        const retry = await run(conn, `${cd} && pwd && ls -la`); // an `ls` without -A
        if (retry.code !== 0) throw failure(r.stderr.trim() ? r : retry, 'Could not list the folder');
        r = retry;
      }
      const nl = r.stdout.indexOf('\n');
      const real = (nl === -1 ? r.stdout : r.stdout.slice(0, nl)).trim() || dir;
      let { entries, unparsed } = parseLs(nl === -1 ? '' : r.stdout.slice(nl + 1));

      if (!entries.length && unparsed) {
        // An unfamiliar `ls -l` layout: fall back to names only (folders end in "/")
        const names = await must(conn, `${cd} && ls -1ap`);
        entries = names.stdout.split('\n').map(s => s.replace(/\r$/, '')).filter(s => s && s !== './' && s !== '../')
          .map(s => ({ name: s.replace(/\/$/, ''), type: s.endsWith('/') ? 'dir' : 'file', size: null, mtime: 0, link: false }));
      } else if (entries.some(e => e.link)) {
        // Which of the links point at folders?
        const dirs = await run(conn, `${cd} && for f in .* *; do [ -d "$f" ] && printf '%s\\n' "$f"; done`);
        const isDir = new Set(dirs.stdout.split('\n'));
        for (const e of entries) {
          if (!e.link) continue;
          e.type = isDir.has(e.name) ? 'dir' : 'file';
          e.size = null; // `ls` shows the link's own length, not the target's
        }
      }
      return { dir: real, entries: sortEntries(entries) };
    },
    mkdir: target => must(conn, `mkdir -- ${q(target)}`),
    rename: (from, to) => must(conn, `mv -- ${q(from)} ${q(to)}`),
    remove: (target, isDir) => must(conn, `${isDir ? 'rmdir' : 'rm -f'} -- ${q(target)}`),
    async head(remote, limit) {
      let r = await run(conn, `head -c ${limit} -- ${q(remote)}`);
      if (r.code !== 0) {
        // A `head` without -c: dd does the same job everywhere
        const dd = await run(conn, `dd if=${q(remote)} bs=1024 count=${Math.ceil(limit / 1024)} 2>/dev/null`);
        if (dd.code !== 0 || (!dd.raw.length && r.stderr.trim())) throw failure(r, 'Could not read the file');
        r = dd;
      }
      return r.raw.subarray(0, limit);
    },
    async size(remote) {
      const r = await must(conn, `wc -c < ${q(remote)}`);
      const n = parseInt(r.stdout.trim(), 10);
      if (!Number.isFinite(n)) throw new Error('Could not read the file size');
      return n;
    },
    read(remote, limit, onProgress, isCancelled) {
      return new Promise((resolve, reject) => {
        conn.exec(`cat -- ${q(remote)}`, (err, ch) => {
          if (err) return reject(err);
          const errOut = [];
          let code = null;
          ch.stderr.on('data', d => errOut.push(d));
          ch.on('exit', c => { code = c; });
          collect(ch, s => { try { s.close(); } catch {} }, limit, onProgress, isCancelled, () =>
            (code === 0 || code === null ? null : new Error(Buffer.concat(errOut).toString('utf8').trim().split('\n').pop() || `cat failed with exit code ${code}`)), 'close')
            .then(resolve, reject);
          ch.end();
        });
      });
    },
    async download(remote, local, size, onProgress) {
      if (await hasScp()) {
        try { await scpDownload(conn, remote, local, onProgress); return 'SCP'; } catch (err) { session.scpError = err.message; }
      }
      await catDownload(conn, remote, local, size, onProgress);
      return 'cat';
    },
    async upload(local, remote, size, onProgress) {
      if (await hasScp()) {
        try { await scpUpload(conn, local, remote, size, onProgress); return 'SCP'; } catch (err) { session.scpError = err.message; }
      }
      await catUpload(conn, local, remote, size, onProgress);
      return 'cat';
    }
  };
}

/* ---------------- IPC ---------------- */

function registerSftp({ ipcMain, dialog, app, sessions, send, getWindow }) {
  function openSftp(session) {
    if (!session.sftp) {
      session.sftp = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the SFTP subsystem did not answer')), SFTP_OPEN_TIMEOUT);
        session.conn.sftp((err, sftp) => {
          clearTimeout(timer);
          if (err) return reject(err);
          sftp.on('close', () => { session.sftp = null; });
          resolve(sftp);
        });
      });
      session.sftp.catch(() => { session.sftp = null; });
    }
    return session.sftp;
  }

  // SFTP if the server has it; otherwise shell commands, decided once per session
  async function backendFor(id) {
    const session = sessions.get(id);
    if (!session || !session.conn) throw new Error('File transfer needs a connected SSH session');
    if (session.fileMode === 'shell') return shellBackend(session);
    try {
      const sftp = await openSftp(session);
      session.fileMode = 'sftp';
      return sftpBackend(sftp);
    } catch (sftpErr) {
      if (sessions.get(id) !== session) throw sftpErr; // the session itself went away
      try {
        const probe = await run(session.conn, 'echo coo-ok');
        if (!probe.stdout.includes('coo-ok')) throw failure(probe, 'it does not run shell commands');
      } catch (shellErr) {
        throw new Error(`SFTP is not available on this host (${sftpErr.message}), and the fallback could not run commands on it either (${shellErr.message}).`);
      }
      session.fileMode = 'shell';
      session.fileNote = sftpErr.message;
      return shellBackend(session);
    }
  }

  // Every handler answers { ok, ... } / { ok: false, error } so the renderer never sees a rejection
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (e, arg) => {
      try {
        return { ok: true, ...(await fn(arg || {})) };
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) };
      }
    });

  handle('sftp:list', async ({ id, dir }) => {
    const be = await backendFor(id);
    return { ...(await be.list(dir)), mode: be.mode, note: be.note || '' };
  });

  handle('sftp:mkdir', async ({ id, dir, name }) => {
    await (await backendFor(id)).mkdir(path.posix.join(dir, name));
    return {};
  });

  handle('sftp:rename', async ({ id, dir, from, to }) => {
    await (await backendFor(id)).rename(path.posix.join(dir, from), path.posix.join(dir, to));
    return {};
  });

  handle('sftp:delete', async ({ id, dir, name, isDir }) => {
    await (await backendFor(id)).remove(path.posix.join(dir, name), isDir);
    return {};
  });

  // Progress events are throttled so a fast transfer doesn't flood the renderer
  const progress = xferId => {
    let last = 0;
    return (transferred, chunk, total) => {
      const now = Date.now();
      if (now - last < 100 && transferred < total) return;
      last = now;
      send('sftp:progress', { xferId, transferred, total });
    };
  };

  handle('sftp:download', async ({ id, dir, name, size, xferId }) => {
    const be = await backendFor(id);
    const res = await dialog.showSaveDialog(getWindow(), {
      title: `Download ${name}`,
      defaultPath: path.join(app.getPath('downloads'), name.replace(/[<>:"/\\|?*]/g, '_'))
    });
    if (res.canceled || !res.filePath) return { cancelled: true };
    send('sftp:progress', { xferId, name, transferred: 0, total: 0, started: true });
    const via = await be.download(path.posix.join(dir, name), res.filePath, size || 0, progress(xferId));
    return { file: res.filePath, via };
  });

  // The first part of a file, as text, for the preview. Binary files get a short hex dump.
  const PREVIEW_BYTES = 256 * 1024;
  const PREVIEW_FULL_BYTES = 100 * 1024 * 1024;

  function hexDump(buf) {
    const lines = [];
    for (let off = 0; off < buf.length; off += 16) {
      const row = buf.subarray(off, off + 16);
      const hex = [...row].map(b => b.toString(16).padStart(2, '0'));
      const left = hex.slice(0, 8).join(' ').padEnd(23);
      const right = hex.slice(8).join(' ').padEnd(23);
      const ascii = [...row].map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
      lines.push(`${off.toString(16).padStart(8, '0')}  ${left}  ${right}  ${ascii}`);
    }
    return lines.join('\n');
  }

  function decodePreview(buf) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2, buf.length - (buf.length % 2)).toString('utf16le') };
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      const swapped = Buffer.from(buf.subarray(2, buf.length - (buf.length % 2)));
      swapped.swap16();
      return { text: swapped.toString('utf16le') };
    }
    // Text never contains NULs, and has very few other control characters
    const sample = buf.subarray(0, 8192);
    let odd = 0;
    for (const b of sample) {
      if (b === 0) return { binary: true };
      if (b < 32 && b !== 9 && b !== 10 && b !== 13 && b !== 27 && b !== 12) odd++;
    }
    if (sample.length && odd / sample.length > 0.1) return { binary: true };
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text: text.replace(/\ufffd+$/, '') }; // a character cut in half by the size limit
  }

  // Normally just the first 256 KB. With `full`, the whole file (up to 100 MB), which the
  // preview asks for once the user scrolls past the end of the first part.
  handle('sftp:preview', async ({ id, dir, name, full, xferId }) => {
    const be = await backendFor(id);
    const remote = path.posix.join(dir, name);
    let buf;
    if (full) {
      const size = await be.size(remote);
      if (size > PREVIEW_FULL_BYTES) {
        throw new Error(`it is ${(size / 1048576).toFixed(0)} MB, and the preview stops at ${PREVIEW_FULL_BYTES / 1048576} MB. Download it to read all of it.`);
      }
      let last = 0;
      try {
        buf = await be.read(remote, PREVIEW_FULL_BYTES, got => {
          const now = Date.now();
          if (now - last < 100 && got < size) return;
          last = now;
          send('sftp:progress', { xferId, transferred: got, total: size });
        }, () => cancelled.has(xferId));
      } finally {
        cancelled.delete(xferId);
      }
    } else {
      buf = await be.head(remote, PREVIEW_BYTES);
    }
    const decoded = decodePreview(buf);
    if (decoded.binary) return { binary: true, text: hexDump(buf.subarray(0, 2048)), shown: Math.min(buf.length, 2048), limit: PREVIEW_BYTES };
    return { binary: false, text: decoded.text, shown: buf.length, limit: PREVIEW_BYTES, full: !!full };
  });

  // Whole-folder download. Works the same over SFTP and the shell fallback because it
  // only needs "list a folder" and "download a file". One bad file doesn't stop the rest.
  const cancelled = new Set();
  ipcMain.on('sftp:cancel', (e, xferId) => cancelled.add(xferId));

  // A remote name as a safe Windows file name (and never a path: no separators, no "..")
  const localName = name => {
    const safe = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
    if (!safe || safe === '.' || safe === '..') return '';
    return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(safe) ? '_' + safe : safe;
  };

  handle('sftp:downloadDir', async ({ id, dir, name, xferId }) => {
    const be = await backendFor(id);
    const res = await dialog.showOpenDialog(getWindow(), {
      title: `Download the folder "${name}" into…`,
      defaultPath: app.getPath('downloads'),
      buttonLabel: 'Download here',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { cancelled: true };

    const dest = path.join(res.filePaths[0], localName(name) || 'download');
    const remoteRoot = path.posix.join(dir, name);
    const stats = { files: 0, bytes: 0, failed: [], skipped: [], via: '' };
    let lastSent = 0;
    const report = (current, extraBytes = 0, force = false) => {
      const now = Date.now();
      if (!force && now - lastSent < 100) return;
      lastSent = now;
      send('sftp:progress', { xferId, folder: true, files: stats.files, bytes: stats.bytes + extraBytes, current });
    };

    async function walk(remoteDir, localDir, depth) {
      const { entries } = await be.list(remoteDir);
      fs.mkdirSync(localDir, { recursive: true });
      for (const entry of entries) {
        if (cancelled.has(xferId)) return;
        const remotePath = path.posix.join(remoteDir, entry.name);
        const shown = path.posix.relative(remoteRoot, remotePath);
        const safe = localName(entry.name);
        if (!safe || entry.special) { stats.skipped.push(shown); continue; }
        if (entry.type === 'dir') {
          // Linked folders are skipped: following them can loop forever or copy things twice
          if (entry.link || depth >= 32) { stats.skipped.push(shown); continue; }
          try {
            await walk(remotePath, path.join(localDir, safe), depth + 1);
          } catch (err) {
            stats.failed.push({ path: shown, error: err.message });
          }
          continue;
        }
        report(shown, 0, true);
        try {
          let fileBytes = 0;
          stats.via = await be.download(remotePath, path.join(localDir, safe), entry.size || 0, transferred => {
            fileBytes = transferred;
            report(shown, transferred);
          });
          stats.files++;
          stats.bytes += fileBytes || entry.size || 0;
        } catch (err) {
          stats.failed.push({ path: shown, error: err.message });
        }
      }
    }

    send('sftp:progress', { xferId, folder: true, files: 0, bytes: 0, current: '' });
    let wasCancelled = false;
    try {
      await walk(remoteRoot, dest, 0);
    } finally {
      wasCancelled = cancelled.delete(xferId);
    }
    return {
      dest,
      files: stats.files,
      bytes: stats.bytes,
      via: stats.via,
      stopped: wasCancelled,
      failedCount: stats.failed.length,
      failed: stats.failed.slice(0, 5),
      skippedCount: stats.skipped.length,
      skipped: stats.skipped.slice(0, 5)
    };
  });

  handle('sftp:upload', async ({ id, dir, files, xferId }) => {
    const be = await backendFor(id);
    let list = files;
    if (!list || !list.length) {
      const res = await dialog.showOpenDialog(getWindow(), {
        title: `Upload to ${dir}`,
        properties: ['openFile', 'multiSelections']
      });
      if (res.canceled || !res.filePaths.length) return { cancelled: true };
      list = res.filePaths;
    }
    const uploaded = [];
    const skipped = [];
    let via = '';
    for (const file of list) {
      const name = path.basename(file);
      let stat;
      try { stat = fs.statSync(file); } catch { skipped.push(name); continue; }
      if (!stat.isFile()) { skipped.push(name); continue; } // folders aren't supported
      send('sftp:progress', { xferId, name, transferred: 0, total: stat.size, started: true });
      via = await be.upload(file, path.posix.join(dir, name), stat.size, progress(xferId));
      uploaded.push(name);
    }
    return { uploaded, skipped, via };
  });
}

module.exports = { registerSftp, parseLs };
