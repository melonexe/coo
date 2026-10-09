/* File preview for the Files panel: Space opens it on the selected file, Space or Esc
   closes it. The first 256 KB loads straight away; scrolling past the end fetches the
   whole file (up to 100 MB). Only the lines on screen are ever in the page, so a huge
   log scrolls as easily as a small config. Ctrl+F searches the loaded text. */

const PV_LINE = 19;            // px, matches .pv-row
const PV_PAD = 10;             // px above the first and below the last line
const PV_OVERSCAN = 30;        // extra lines rendered above and below the viewport
const PV_MAX_HEIGHT = 16000000; // browsers cap element height; past this the scrollbar is scaled
const PV_MAX_LINE = 5000;      // characters shown per line
const PV_MAX_MATCHES = 50000;
const PV_WRAP_MAX_LINES = 20000;

const preview = {
  open: false,
  seq: 0,            // bumped whenever the preview moves on, so late replies are dropped
  entry: null,
  text: '',
  starts: [0],       // character offset of each line start
  lines: 0,
  binary: false,
  truncated: false,  // showing only the first part of the file
  fullFailed: false, // loading the rest was tried and refused (too large, read error)
  loadingFull: false,
  xferId: null,
  wrap: false,
  first: -1,         // rendered line range (virtual mode)
  last: -1,
  find: { open: false, needle: '', matchCase: false, matches: [], len: 0, index: -1, timer: null }
};

const pvBody = () => $('#preview-body');

function setPreviewStatus(text, kind = '', onClick = null) {
  const node = $('#preview-status');
  node.textContent = text;
  node.className = kind + (onClick ? ' link' : '');
  node.title = onClick ? text : '';
  node.onclick = onClick;
}

function previewNote(text, kind = '') {
  preview.text = '';
  preview.lines = 0;
  preview.starts = [0];
  const body = pvBody();
  body.className = 'preview-body';
  body.innerHTML = '';
  body.appendChild(el('div', 'preview-note ' + kind, text));
}

/* ---------------- Text model ---------------- */

function setPreviewText(text, { keepLine = 0 } = {}) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  preview.text = text;
  preview.starts = starts;
  preview.lines = Math.max(1, starts.length - (text.endsWith('\n') ? 1 : 0));

  // Wrapping needs every line laid out, so it is only offered for modest files
  const canWrap = preview.lines <= PV_WRAP_MAX_LINES && !preview.binary;
  const box = $('#preview-wrap');
  box.disabled = !canWrap;
  box.parentElement.title = canWrap ? '' : 'Wrapping is only available for files up to 20,000 lines';
  if (!canWrap) { preview.wrap = false; box.checked = false; }

  const body = pvBody();
  body.className = 'preview-body' + (preview.wrap ? ' wrap' : '') + (preview.binary ? ' binary' : '');
  body.style.setProperty('--pv-digits', String(preview.lines).length);
  body.innerHTML = '';
  const spacer = el('div', 'pv-spacer');
  spacer.appendChild(el('div', 'pv-window'));
  body.appendChild(spacer);
  preview.first = preview.last = -1;

  renderPreview(true);
  scrollPreviewToLine(keepLine, false);
}

// [start, end) of line i, without its line ending
function previewLineRange(i) {
  const start = preview.starts[i];
  let end = i + 1 < preview.starts.length ? preview.starts[i + 1] - 1 : preview.text.length;
  if (end > start && preview.text.charCodeAt(end - 1) === 13) end--; // CRLF
  return [start, end];
}

function previewLineOf(pos) {
  const starts = preview.starts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return Math.min(lo, preview.lines - 1);
}

/* ---------------- Rendering ---------------- */

function buildPreviewRow(i) {
  const row = el('div', 'pv-row');
  row.appendChild(el('span', 'pv-num', String(i + 1)));
  const txt = el('span', 'pv-txt');
  const [start, fullEnd] = previewLineRange(i);
  const end = Math.min(fullEnd, start + PV_MAX_LINE);
  const text = preview.text;
  const { matches, len, index } = preview.find;

  let at = start;
  if (matches.length) {
    // first match that could reach into this line
    let lo = 0;
    let hi = matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (matches[mid] + len <= start) lo = mid + 1; else hi = mid;
    }
    for (let m = lo; m < matches.length && matches[m] < end; m++) {
      const from = Math.max(matches[m], start);
      const to = Math.min(matches[m] + len, end);
      if (from > at) txt.appendChild(document.createTextNode(text.slice(at, from)));
      const mark = el('mark', 'pv-hit' + (m === index ? ' cur' : ''), text.slice(from, to));
      txt.appendChild(mark);
      at = to;
    }
  }
  if (end > at) txt.appendChild(document.createTextNode(text.slice(at, end)));
  if (fullEnd > end) txt.appendChild(el('span', 'pv-more', `  … ${(fullEnd - end).toLocaleString()} more characters on this line`));
  if (!txt.firstChild) txt.appendChild(document.createTextNode(''));
  row.appendChild(txt);
  return row;
}

// Virtual scroll geometry: real pixel heights, squeezed when the file is taller than a page can be
function previewGeometry() {
  const body = pvBody();
  const viewH = body.clientHeight;
  const total = preview.lines * PV_LINE + PV_PAD * 2;
  const height = Math.min(total, PV_MAX_HEIGHT);
  const maxScroll = Math.max(0, height - viewH);
  const maxVirtual = Math.max(0, total - viewH);
  return { body, viewH, total, height, maxScroll, maxVirtual };
}

function renderPreview(force = false) {
  if (!preview.open || !preview.lines) return;
  const body = pvBody();
  const spacer = body.firstElementChild;
  if (!spacer || !spacer.classList.contains('pv-spacer')) return;
  const win = spacer.firstElementChild;

  if (preview.wrap) {
    if (!force && preview.first === 0) return;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < preview.lines; i++) frag.appendChild(buildPreviewRow(i));
    win.style.top = '';
    win.replaceChildren(frag);
    preview.first = 0;
    preview.last = preview.lines;
    return;
  }

  const g = previewGeometry();
  spacer.style.height = g.height + 'px';
  const virtualTop = g.maxScroll ? (body.scrollTop / g.maxScroll) * g.maxVirtual : 0;
  const top = Math.max(0, Math.floor((virtualTop - PV_PAD) / PV_LINE));
  const first = Math.max(0, top - PV_OVERSCAN);
  const last = Math.min(preview.lines, top + Math.ceil(g.viewH / PV_LINE) + PV_OVERSCAN);
  // Where the rendered block sits so that line `top` lines up with the viewport
  win.style.top = (body.scrollTop - (virtualTop - (first * PV_LINE + PV_PAD))) + 'px';
  if (!force && first === preview.first && last === preview.last) return;

  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) frag.appendChild(buildPreviewRow(i));
  win.replaceChildren(frag);
  preview.first = first;
  preview.last = last;
}

function previewTopLine() {
  if (!preview.lines) return 0;
  const body = pvBody();
  if (preview.wrap) {
    const rows = body.querySelectorAll('.pv-row');
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].offsetTop + rows[mid].offsetHeight <= body.scrollTop) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  const g = previewGeometry();
  const virtualTop = g.maxScroll ? (body.scrollTop / g.maxScroll) * g.maxVirtual : 0;
  return Math.max(0, Math.min(preview.lines - 1, Math.floor((virtualTop - PV_PAD) / PV_LINE)));
}

function scrollPreviewToLine(line, center) {
  if (!preview.lines) return;
  const body = pvBody();
  if (preview.wrap) {
    const row = body.querySelectorAll('.pv-row')[line];
    if (row) body.scrollTop = Math.max(0, row.offsetTop - (center ? body.clientHeight / 2 : PV_PAD));
    return;
  }
  const g = previewGeometry();
  let virtualTop = line * PV_LINE + (line ? PV_PAD : 0) - (center ? g.viewH / 2 - PV_LINE : 0);
  virtualTop = Math.max(0, Math.min(g.maxVirtual, virtualTop));
  body.scrollTop = g.maxVirtual ? (virtualTop / g.maxVirtual) * g.maxScroll : 0;
  renderPreview();
}

/* ---------------- Opening, closing, loading ---------------- */

function stopFullLoad() {
  if (preview.loadingFull && preview.xferId) window.api.sftpCancel(preview.xferId);
  preview.loadingFull = false;
  preview.xferId = null;
}

function describeLoaded() {
  const n = preview.lines;
  return `${n.toLocaleString()} line${n === 1 ? '' : 's'}`;
}

async function showPreview() {
  const entry = selectedEntry();
  const target = sftpTarget();
  if (!entry || !target) return;
  stopFullLoad();
  preview.open = true;
  preview.entry = entry;
  preview.binary = false;
  preview.truncated = false;
  preview.fullFailed = false;
  const seq = ++preview.seq;

  $('#preview').classList.remove('hidden');
  $('#preview-name').textContent = entry.name;
  $('#preview-meta').textContent = [joinDir(sftp.dir, entry.name), entry.type === 'dir' ? 'Folder' : formatSize(entry.size), entry.mtime ? `modified ${formatDate(entry.mtime)}` : ''].filter(Boolean).join('  ·  ');
  $('#preview-download').textContent = entry.type === 'dir' ? 'Download folder…' : 'Download…';
  setPreviewStatus('');
  preview.find.matches = [];
  preview.find.index = -1;
  renderPreviewFindCount();

  if (entry.type === 'dir') { previewNote('This is a folder. Press Enter to open it.'); return; }
  if (entry.special) { previewNote('This is a device, pipe or socket, not a regular file, so there is nothing to preview.'); return; }
  if (entry.size === 0) { previewNote('This file is empty.'); return; }

  previewNote('Loading…');
  const res = await window.api.sftpPreview({ ...target, name: entry.name });
  if (seq !== preview.seq || !preview.open) return; // closed, or moved to another file, meanwhile
  if (!res.ok) { previewNote(`Could not read the file: ${res.error}`, 'error'); return; }
  if (!res.text) { previewNote('This file is empty.'); return; }

  preview.binary = !!res.binary;
  preview.truncated = !res.binary && (res.shown >= res.limit || (entry.size != null && entry.size > res.shown));
  setPreviewText(res.text);

  if (res.binary) setPreviewStatus(`Binary file — showing the first ${formatSize(res.shown)} as hex`, 'warn');
  else if (preview.truncated) {
    setPreviewStatus(`Showing the first ${formatSize(res.shown)}${entry.size ? ` of ${formatSize(entry.size)}` : ''} — scroll past the end, or click here, to load the whole file`, 'warn', loadFullPreview);
  } else setPreviewStatus(describeLoaded());
  if (preview.find.open) runPreviewFind();
}

// Fetch the rest of the file and carry on from the line the user was reading
async function loadFullPreview() {
  if (!preview.open || !preview.truncated || preview.loadingFull || preview.fullFailed) return;
  const target = sftpTarget();
  const entry = preview.entry;
  if (!target || !entry) return;
  const seq = preview.seq;
  const xferId = 'pv' + Date.now();
  preview.loadingFull = true;
  preview.xferId = xferId;
  setPreviewStatus('Loading the whole file…', 'warn');

  const res = await window.api.sftpPreview({ ...target, name: entry.name, full: true, xferId });
  if (seq !== preview.seq || preview.xferId !== xferId) return; // the preview has moved on
  preview.loadingFull = false;
  preview.xferId = null;

  if (!res.ok || res.binary) {
    preview.fullFailed = true; // don't try again on every scroll
    setPreviewStatus(`Still showing only the first part of this file: ${res.ok ? 'the rest is not text' : res.error}`, 'error');
    return;
  }
  const keep = previewTopLine();
  preview.truncated = false;
  setPreviewText(res.text, { keepLine: keep });
  setPreviewStatus(`${describeLoaded()} · whole file loaded (${formatSize(res.shown)})`);
  if (preview.find.open) runPreviewFind({ keepView: true });
}

function closePreview() {
  if (!preview.open) return;
  stopFullLoad();
  preview.open = false;
  preview.seq++;
  closePreviewFind({ refocus: false });
  $('#preview').classList.add('hidden');
  pvBody().innerHTML = '';
  preview.text = ''; // let a large file go
  preview.starts = [0];
  preview.lines = 0;
  if (sideOpen === 'sftp') $('#sftp-list').focus();
}

const togglePreview = () => (preview.open ? closePreview() : showPreview());

window.api.onSftpProgress(({ xferId, transferred, total }) => {
  if (!preview.loadingFull || xferId !== preview.xferId) return;
  const pct = total ? `${Math.floor((transferred / total) * 100)}% ` : '';
  setPreviewStatus(`Loading the whole file… ${pct}(${formatSize(transferred)}${total ? ` of ${formatSize(total)}` : ''})`, 'warn');
});

/* ---------------- Find in the preview ---------------- */

function renderPreviewFindCount() {
  const f = preview.find;
  const label = $('#pvfind-count');
  const n = f.matches.length;
  label.classList.toggle('none', !!f.needle && !n);
  if (!f.needle) label.textContent = '';
  else if (!n) label.textContent = 'No results';
  else label.textContent = `${(f.index + 1).toLocaleString()} of ${n.toLocaleString()}${n >= PV_MAX_MATCHES ? '+' : ''}`;
  label.title = preview.truncated && f.needle ? 'Only the part of the file loaded so far was searched' : '';
}

function runPreviewFind({ keepView = false } = {}) {
  const f = preview.find;
  f.matches = [];
  f.index = -1;
  f.len = f.needle.length;
  if (f.needle && preview.lines) {
    const re = new RegExp(f.needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.matchCase ? 'g' : 'gi');
    let m;
    while (f.matches.length < PV_MAX_MATCHES && (m = re.exec(preview.text))) {
      f.matches.push(m.index);
      if (!m[0].length) re.lastIndex++;
    }
    if (f.matches.length) {
      // start from the first match at or below what is on screen
      const from = preview.starts[previewTopLine()];
      let i = f.matches.findIndex(pos => pos >= from);
      if (i === -1) i = 0;
      f.index = i;
    }
  }
  if (f.index >= 0 && !keepView) revealPreviewMatch();
  else { renderPreview(true); renderPreviewFindCount(); }
}

function revealPreviewMatch() {
  const f = preview.find;
  const pos = f.matches[f.index];
  if (pos == null) return;
  const line = previewLineOf(pos);
  const top = previewTopLine();
  const visible = Math.floor(pvBody().clientHeight / PV_LINE) - 2;
  if (preview.wrap || line < top || line > top + visible) scrollPreviewToLine(line, true);
  renderPreview(true);
  const mark = pvBody().querySelector('mark.pv-hit.cur');
  if (mark) mark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderPreviewFindCount();
}

function stepPreviewFind(delta) {
  const f = preview.find;
  if (!f.matches.length) return;
  f.index = (f.index + delta + f.matches.length) % f.matches.length;
  revealPreviewMatch();
}

function openPreviewFind() {
  if (!preview.open) return;
  preview.find.open = true;
  $('#preview-find').classList.remove('hidden');
  const input = $('#pvfind-input');
  const picked = String(document.getSelection() || '').split('\n')[0];
  if (picked && picked.length <= 200 && pvBody().contains(document.getSelection().anchorNode)) input.value = picked;
  input.focus();
  input.select();
  if (input.value !== preview.find.needle) { preview.find.needle = input.value; runPreviewFind(); }
  renderPreview();
}

function closePreviewFind({ refocus = true } = {}) {
  const f = preview.find;
  if (!f.open) return;
  f.open = false;
  clearTimeout(f.timer);
  f.matches = [];
  f.index = -1;
  f.needle = '';
  $('#pvfind-input').value = '';
  $('#preview-find').classList.add('hidden');
  renderPreviewFindCount();
  if (preview.open) {
    renderPreview(true);
    if (refocus) pvBody().focus();
  }
}

$('#pvfind-input').addEventListener('input', ev => {
  const f = preview.find;
  f.needle = ev.target.value;
  clearTimeout(f.timer);
  f.timer = setTimeout(runPreviewFind, preview.text.length > 5000000 ? 350 : 120);
});
$('#pvfind-input').addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const f = preview.find;
  if (f.needle !== ev.target.value || (f.index === -1 && f.needle)) {
    clearTimeout(f.timer);
    f.needle = ev.target.value;
    runPreviewFind();
  } else stepPreviewFind(ev.shiftKey ? -1 : 1);
});
$('#pvfind-next').addEventListener('click', () => { stepPreviewFind(1); $('#pvfind-input').focus(); });
$('#pvfind-prev').addEventListener('click', () => { stepPreviewFind(-1); $('#pvfind-input').focus(); });
$('#pvfind-close').addEventListener('click', () => closePreviewFind());
$('#pvfind-case').addEventListener('click', ev => {
  preview.find.matchCase = !preview.find.matchCase;
  ev.currentTarget.classList.toggle('active', preview.find.matchCase);
  runPreviewFind();
  $('#pvfind-input').focus();
});
$('#preview-find-btn').addEventListener('click', () => (preview.find.open ? closePreviewFind() : openPreviewFind()));

/* ---------------- Wiring ---------------- */

let pvScrollQueued = false;
pvBody().addEventListener('scroll', () => {
  if (pvScrollQueued) return;
  pvScrollQueued = true;
  requestAnimationFrame(() => { pvScrollQueued = false; renderPreview(); });
});

// Trying to go past the end of a partly loaded file fetches the rest of it
const pvAtBottom = () => {
  const body = pvBody();
  return body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
};
pvBody().addEventListener('wheel', ev => { if (ev.deltaY > 0 && preview.truncated && pvAtBottom()) loadFullPreview(); }, { passive: true });
pvBody().addEventListener('keydown', ev => {
  if (['ArrowDown', 'PageDown', 'End'].includes(ev.key) && preview.truncated && pvAtBottom()) loadFullPreview();
});

new ResizeObserver(() => renderPreview()).observe(pvBody());

// Space closes the preview even when the click landed inside it (but still types in the find box)
$('#preview').addEventListener('keydown', ev => {
  if (ev.key === ' ' && ev.target.tagName !== 'INPUT' && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); closePreview(); }
});
$('#preview-close').addEventListener('click', closePreview);
$('#preview-download').addEventListener('click', () => {
  const entry = preview.entry;
  if (!entry) return;
  if (entry.type === 'dir') downloadFolder(entry); else downloadEntry(entry);
});
$('#preview-wrap').addEventListener('change', ev => {
  if (!preview.lines) { preview.wrap = ev.target.checked; return; }
  const keep = previewTopLine();
  preview.wrap = ev.target.checked;
  pvBody().classList.toggle('wrap', preview.wrap);
  preview.first = preview.last = -1;
  const spacer = pvBody().firstElementChild;
  if (spacer) spacer.style.height = '';
  renderPreview(true);
  scrollPreviewToLine(keep, false);
});
