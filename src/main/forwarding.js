// SSH port forwarding: local (-L), remote (-R) and dynamic SOCKS5 (-D).
const net = require('net');

function link(a, b) {
  a.pipe(b);
  b.pipe(a);
  const kill = () => { try { a.destroy(); } catch {} try { b.destroy(); } catch {} };
  a.on('error', kill);
  b.on('error', kill);
  a.on('close', kill);
  b.on('close', kill);
}

function validPort(p) {
  const n = parseInt(p, 10);
  return n > 0 && n < 65536 ? n : null;
}

function describeForward(r) {
  if (r.type === 'dynamic') return `SOCKS5 proxy on ${r.bindAddr || '127.0.0.1'}:${r.srcPort}`;
  if (r.type === 'remote') return `remote ${r.bindAddr || '127.0.0.1'}:${r.srcPort} -> ${r.dstHost}:${r.dstPort}`;
  return `local ${r.bindAddr || '127.0.0.1'}:${r.srcPort} -> ${r.dstHost}:${r.dstPort}`;
}

// Minimal SOCKS5 (no auth, CONNECT only). Calls open(host, port, cb(err, stream)).
function socks5(sock, open) {
  let buf = Buffer.alloc(0);
  let stage = 0;
  const onData = chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === 0) {
      if (buf.length < 2) return;
      if (buf[0] !== 5) return sock.destroy();
      const n = buf[1];
      if (buf.length < 2 + n) return;
      buf = buf.subarray(2 + n);
      sock.write(Buffer.from([5, 0]));
      stage = 1;
    }
    if (stage === 1) {
      if (buf.length < 5) return;
      if (buf[0] !== 5 || buf[1] !== 1) { sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      const atyp = buf[3];
      let host, end;
      if (atyp === 1) { if (buf.length < 10) return; host = [...buf.subarray(4, 8)].join('.'); end = 8; }
      else if (atyp === 3) { const l = buf[4]; if (buf.length < 7 + l) return; host = buf.subarray(5, 5 + l).toString('utf8'); end = 5 + l; }
      else if (atyp === 4) {
        if (buf.length < 22) return;
        const parts = [];
        for (let i = 4; i < 20; i += 2) parts.push(buf.readUInt16BE(i).toString(16));
        host = parts.join(':'); end = 20;
      } else { sock.end(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      const port = buf.readUInt16BE(end);
      const rest = buf.subarray(end + 2);
      stage = 2;
      sock.removeListener('data', onData);
      sock.pause();
      open(host, port, (err, stream) => {
        if (err || sock.destroyed) {
          if (stream) { try { stream.destroy(); } catch {} }
          if (!sock.destroyed) sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
          return;
        }
        sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (rest.length) stream.write(rest);
        link(sock, stream);
        sock.resume();
      });
    }
  };
  sock.on('data', onData);
  sock.on('error', () => {});
}

// notify(level, message). Returns a function that tears every forward down.
function setupForwards(conn, rules, notify) {
  const servers = [];
  const sockets = new Set();
  const remote = new Map(); // remote bind port -> rule
  let closed = false;

  const track = sock => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  };

  const listen = (rule, onConnection) => {
    const server = net.createServer(sock => { track(sock); onConnection(sock); });
    server.on('error', err => notify('error', `Port forward failed (${describeForward(rule)}): ${err.message}`));
    server.listen(rule.srcPort, rule.bindAddr || '127.0.0.1', () => notify('info', `Port forward active: ${describeForward(rule)}`));
    servers.push(server);
  };

  for (const raw of rules || []) {
    const rule = { ...raw, srcPort: validPort(raw.srcPort), dstPort: validPort(raw.dstPort), dstHost: String(raw.dstHost || '').trim() };
    if (!rule.srcPort) { notify('error', `Port forward skipped: invalid port "${raw.srcPort}"`); continue; }

    if (rule.type === 'dynamic') {
      listen(rule, sock => socks5(sock, (host, port, cb) => {
        if (closed) return cb(new Error('closed'));
        conn.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, host, port, cb);
      }));
      continue;
    }

    if (!rule.dstHost || !rule.dstPort) { notify('error', `Port forward skipped: destination missing for port ${rule.srcPort}`); continue; }

    if (rule.type === 'remote') {
      conn.forwardIn(rule.bindAddr || '127.0.0.1', rule.srcPort, err => {
        if (err) return notify('error', `Port forward failed (${describeForward(rule)}): ${err.message}`);
        remote.set(rule.srcPort, rule);
        notify('info', `Port forward active: ${describeForward(rule)}`);
      });
    } else {
      listen(rule, sock => {
        sock.on('error', () => {});
        conn.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, rule.dstHost, rule.dstPort, (err, stream) => {
          if (err || sock.destroyed) {
            if (stream) { try { stream.destroy(); } catch {} }
            return sock.destroy();
          }
          link(sock, stream);
        });
      });
    }
  }

  conn.on('tcp connection', (info, accept, reject) => {
    const rule = remote.get(info.destPort);
    if (!rule || closed) return reject();
    const sock = net.connect(rule.dstPort, rule.dstHost);
    track(sock);
    let accepted = false;
    sock.once('connect', () => { accepted = true; link(sock, accept()); });
    sock.on('error', () => { if (!accepted) reject(); });
  });

  return () => {
    closed = true;
    for (const s of servers) { try { s.close(); } catch {} }
    for (const s of sockets) { try { s.destroy(); } catch {} }
  };
}

module.exports = { setupForwards, describeForward };
