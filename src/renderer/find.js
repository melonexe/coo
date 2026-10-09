/* Find bar: a browser-style search over the scrollback of every open terminal
   (or just the focused one). Enter / Shift+Enter step through the matches and
   switch tab or pane when the next match lives in another terminal. */

const find = {
  open: false,
  query: '',
  matchCase: false,
  allTerminals: true,
  matches: [],      // { pane, row, col, len } — row is an absolute buffer line, len in cells
  index: -1,
  epoch: -1,        // dataEpoch the matches were computed at
  decorations: [],  // { marker, decoration }
  timer: null
};

const FIND_MAX_MATCHES = 5000;
const FIND_MAX_MARKS_PER_PANE = 400;

/* Read one logical line (a row plus the rows it wrapped onto) and a way to turn a
   string index back into a cell position. Rows of plain ASCII map 1:1; anything
   else is walked cell by cell so wide characters don't shift the highlight. */
function readLogicalLine(buffer, startRow, cols) {
  let endRow = startRow;
  while (endRow + 1 < buffer.length) {
    const next = buffer.getLine(endRow + 1);
    if (!next || !next.isWrapped) break;
    endRow++;
  }

  let text = '';
  let simple = true;
  for (let r = startRow; r <= endRow; r++) {
    const s = buffer.getLine(r).translateToString(false);
    if (s.length !== cols || /[^\x20-\x7e]/.test(s)) { simple = false; break; }
    text += s;
  }
  if (simple) {
    return { text, endRow, cellAt: i => [startRow + Math.floor(i / cols), i % cols] };
  }

  text = '';
  const cells = []; // string index -> [row, col]
  for (let r = startRow; r <= endRow; r++) {
    const line = buffer.getLine(r);
    for (let x = 0; x < cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue; // second half of a wide character
      const chars = cell.getChars() || ' ';
      for (let k = 0; k < chars.length; k++) cells.push([r, x]);
      text += chars;
    }
  }
  return { text, endRow, cellAt: i => cells[Math.min(i, cells.length - 1)] };
}

function searchPane(pane, needle, matchCase, out) {
  const buffer = pane.term.buffer.active;
  const cols = pane.term.cols;
  let count = 0;
  for (let row = 0; row < buffer.length; row++) {
    const first = buffer.getLine(row);
    if (!first) continue;
    const { text, endRow, cellAt } = readLogicalLine(buffer, row, cols);
    const hay = matchCase ? text : text.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      const [r1, c1] = cellAt(at);
      const [r2, c2] = cellAt(at + needle.length - 1);
      out.push({ pane, row: r1, col: c1, len: (r2 - r1) * cols + (c2 - c1) + 1 });
      count++;
      from = at + needle.length;
      if (out.length >= FIND_MAX_MATCHES) return count;
    }
    row = endRow;
  }
  return count;
}

function clearFindMarks() {
  for (const { marker, decoration } of find.decorations) {
    try { decoration.dispose(); } catch {}
    try { marker.dispose(); } catch {}
  }
  find.decorations = [];
}

// Soft highlight on every match (the current one is shown as the selection)
function markMatches() {
  clearFindMarks();
  const perPane = new Map();
  for (let i = find.matches.length - 1; i >= 0; i--) { // newest first, so the cap keeps recent output
    const m = find.matches[i];
    const used = perPane.get(m.pane) || 0;
    if (used >= FIND_MAX_MARKS_PER_PANE) continue;
    perPane.set(m.pane, used + 1);

    const term = m.pane.term;
    const buffer = term.buffer.active;
    const cols = term.cols;
    let left = m.len;
    let row = m.row;
    let col = m.col;
    while (left > 0) { // one decoration per row the match touches
      const width = Math.min(left, cols - col);
      try {
        const marker = term.registerMarker(row - (buffer.baseY + buffer.cursorY));
        const decoration = marker && term.registerDecoration({ marker, x: col, width, layer: 'top' });
        if (decoration) {
          decoration.onRender(node => node.classList.add('find-hit'));
          find.decorations.push({ marker, decoration });
        } else if (marker) {
          marker.dispose();
        }
      } catch {}
      left -= width;
      row++;
      col = 0;
    }
  }
}

function findScope() {
  if (find.allTerminals) return allPanes();
  const pane = activePane();
  return pane ? [pane] : [];
}

function runFind({ keep = false } = {}) {
  const previous = keep && find.index >= 0 ? find.matches[find.index] : null;
  for (const p of allPanes()) dropSelection(p.term);
  find.matches = [];
  find.index = -1;
  find.epoch = dataEpoch;

  const needle = find.matchCase ? find.query : find.query.toLowerCase();
  const counts = new Map();
  if (needle) {
    for (const pane of findScope()) {
      if (find.matches.length >= FIND_MAX_MATCHES) break;
      const n = searchPane(pane, needle, find.matchCase, find.matches);
      if (n) counts.set(pane, n);
    }
  }

  markMatches();
  renderFindChips(counts);

  if (!find.matches.length) {
    renderFindCount();
    return;
  }

  let index = -1;
  if (previous) {
    index = find.matches.findIndex(m => m.pane === previous.pane && m.row === previous.row && m.col === previous.col);
  }
  if (index === -1) {
    // Start at the most recent match in the focused terminal, else the most recent anywhere
    const current = activePane();
    for (let i = find.matches.length - 1; i >= 0; i--) {
      if (find.matches[i].pane === current) { index = i; break; }
    }
    if (index === -1) index = find.matches.length - 1;
  }
  showMatch(index);
}

function showMatch(index) {
  const m = find.matches[index];
  if (!m || m.pane.disposed) return;
  find.index = index;

  for (const p of allPanes()) if (p !== m.pane) dropSelection(p.term);
  if (state.activeTabId !== m.pane.tab.id) activateTab(m.pane.tab.id, { keyboard: false });
  if (m.pane.tab.activePaneId !== m.pane.id) focusPane(m.pane, { keyboard: false });

  const term = m.pane.term;
  const reveal = () => {
    if (m.pane.disposed || find.matches[find.index] !== m) return;
    term.scrollToLine(Math.max(0, m.row - Math.floor(term.rows / 2)));
    term.select(m.col, m.row, m.len);
  };
  reveal();
  requestAnimationFrame(reveal); // again once a newly shown tab has been laid out
  renderFindCount();
}

function stepFind(delta) {
  if (!find.query) return;
  if (find.epoch !== dataEpoch || find.matches.some(m => m.pane.disposed)) runFind({ keep: true });
  const n = find.matches.length;
  if (!n) return;
  showMatch((find.index + delta + n) % n);
}

function renderFindCount() {
  const label = $('#find-count');
  const n = find.matches.length;
  label.classList.toggle('none', !!find.query && !n);
  if (!find.query) label.textContent = '';
  else if (!n) label.textContent = 'No results';
  else label.textContent = `${find.index + 1} of ${n >= FIND_MAX_MATCHES ? n + '+' : n}`;
}

// One chip per terminal that has matches; click to jump to its latest match
function renderFindChips(counts) {
  const box = $('#find-chips');
  box.innerHTML = '';
  if (!find.allTerminals || counts.size < 1 || allPanes().length < 2) return;
  for (const [pane, n] of counts) {
    const title = pane.tab.panes.length > 1 ? `${tabTitle(pane.tab)} · pane ${pane.tab.panes.indexOf(pane) + 1}` : tabTitle(pane.tab);
    const chip = el('button', 'find-chip');
    chip.type = 'button';
    chip.append(el('span', 'find-chip-name', title), el('span', 'find-chip-count', String(n)));
    chip.addEventListener('click', () => {
      for (let i = find.matches.length - 1; i >= 0; i--) {
        if (find.matches[i].pane === pane) { showMatch(i); break; }
      }
      $('#find-input').focus();
    });
    box.appendChild(chip);
  }
}

function openFind() {
  const pane = activePane();
  const selected = pane && pane.term.hasSelection() ? pane.term.getSelection().split('\n')[0].trim() : '';
  find.open = true;
  $('#findbar').classList.remove('hidden');
  $('#tb-find').classList.add('active');
  const input = $('#find-input');
  if (selected && selected.length <= 200) input.value = selected;
  input.focus();
  input.select();
  find.query = input.value;
  runFind();
}

function closeFind() {
  if (!find.open) return;
  find.open = false;
  clearTimeout(find.timer);
  $('#findbar').classList.add('hidden');
  $('#tb-find').classList.remove('active');
  clearFindMarks();
  find.matches = [];
  find.index = -1;
  $('#find-chips').innerHTML = '';
  const pane = activePane();
  if (pane) pane.term.focus(); // the current match stays selected, ready to copy
}

function syncFindButtons() {
  $('#find-case').classList.toggle('active', find.matchCase);
  $('#find-scope').classList.toggle('active', find.allTerminals);
  $('#find-input').placeholder = find.allTerminals ? 'Find in all terminals…' : 'Find in this terminal…';
}

$('#find-input').addEventListener('input', ev => {
  find.query = ev.target.value;
  clearTimeout(find.timer);
  find.timer = setTimeout(runFind, 120);
});
$('#find-input').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    clearTimeout(find.timer);
    if (find.query !== ev.target.value || (find.index === -1 && find.query)) { find.query = ev.target.value; runFind(); }
    else stepFind(ev.shiftKey ? -1 : 1);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    closeFind();
  }
});
$('#find-next').addEventListener('click', () => { stepFind(1); $('#find-input').focus(); });
$('#find-prev').addEventListener('click', () => { stepFind(-1); $('#find-input').focus(); });
$('#find-close').addEventListener('click', closeFind);
$('#find-case').addEventListener('click', () => { find.matchCase = !find.matchCase; syncFindButtons(); runFind(); $('#find-input').focus(); });
$('#find-scope').addEventListener('click', () => { find.allTerminals = !find.allTerminals; syncFindButtons(); runFind(); $('#find-input').focus(); });
$('#tb-find').addEventListener('click', () => (find.open ? closeFind() : openFind()));

document.addEventListener('coo:find', openFind);
// F3 / Shift+F3 step through matches from anywhere while the bar is open
document.addEventListener('keydown', ev => {
  if (ev.key === 'F3' && find.open) {
    ev.preventDefault();
    ev.stopPropagation();
    stepFind(ev.shiftKey ? -1 : 1);
  }
}, true);
// A closed pane takes its matches with it
document.addEventListener('coo:panestate', () => {
  if (find.open && find.matches.some(m => m.pane.disposed)) runFind({ keep: true });
});

syncFindButtons();
