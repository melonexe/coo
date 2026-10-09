// Plain-text session logging: strips terminal escape sequences so the file
// reads like the screen did, with optional per-line timestamps.
const fs = require('fs');
const { StringDecoder } = require('string_decoder');

// CSI, OSC, DCS/PM/APC strings, charset selection, and remaining 2-byte escapes
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[()*+][0-9A-Za-z]|\x1b[ -/]*[0-~]/g;

function stamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}] `;
}

function createLogger(file, { append = false, timestamps = false, title = '' } = {}) {
  const out = fs.createWriteStream(file, { flags: append ? 'a' : 'w' });
  let dead = false;
  out.on('error', () => { dead = true; });

  const decoder = new StringDecoder('utf8');
  let carry = '';          // unfinished escape sequence from the last chunk
  let lineHasText = false; // something has been written on the current line
  let pendingCR = false;   // saw a CR; what it means depends on what follows

  const header = `--- CooTerm log ${append ? 'resumed' : 'started'} ${new Date().toLocaleString('en-GB')}${title ? ' — ' + title : ''} ---\n`;
  out.write((append ? '\n' : '') + header);

  function write(buf) {
    if (dead) return;
    let s = carry + decoder.write(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    carry = '';

    // Hold back an escape sequence that is still arriving
    const esc = s.lastIndexOf('\x1b');
    if (esc !== -1 && s.length - esc < 256) {
      const tail = s.slice(esc);
      ANSI_RE.lastIndex = 0;
      const m = ANSI_RE.exec(tail);
      const complete = m && m.index === 0 && !(m[0].length === 2 && /[\[\]PX^_()*+]/.test(m[0][1]));
      if (!complete) { carry = tail; s = s.slice(0, esc); }
    }

    s = s.replace(ANSI_RE, '');
    while (/[^\n\r\x08]\x08/.test(s)) s = s.replace(/[^\n\r\x08]\x08/g, ''); // apply backspaces
    s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

    // CR LF is a newline. A lone CR returns to the start of the line: if the line
    // already has text (a progress bar redrawing, a CR-only device) what follows
    // goes on a new line so nothing is lost; on an empty line it means nothing.
    let res = '';
    for (const ch of s) {
      if (ch === '\n') {
        if (timestamps && !lineHasText) res += stamp();
        res += '\n';
        lineHasText = false;
        pendingCR = false;
      } else if (ch === '\r') {
        pendingCR = true;
      } else {
        if (pendingCR && lineHasText) { res += '\n'; lineHasText = false; }
        pendingCR = false;
        if (timestamps && !lineHasText) res += stamp();
        res += ch;
        lineHasText = true;
      }
    }
    if (res) out.write(res);
  }

  function close() {
    if (dead) return;
    dead = true;
    out.end(`\n--- CooTerm log ended ${new Date().toLocaleString('en-GB')} ---\n`);
  }

  return { file, write, close };
}

module.exports = { createLogger };
