/* Snippets: saved commands sent to the focused terminal with one click. */

const snip = { items: [], loaded: false, editingId: null };

async function loadSnippets() {
  snip.items = await window.api.loadSnippets();
  snip.loaded = true;
  renderSnippets();
}

async function ensureSnippets() {
  if (!snip.loaded) await loadSnippets();
}

function persistSnippets() {
  if (!snip.loaded) return; // never overwrite the file before it has been read
  window.api.saveSnippets(snip.items);
  renderSnippets();
}

/* A line that is just "sleep 5" (seconds) or "sleep 500ms" is not sent: CooTerm waits
   that long before sending the next lines. To send a real sleep command, write it any
   other way, e.g. "\sleep 5" or "sleep 5;". */

const SLEEP_LINE = /^\s*sleep\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)?\s*$/i;
const MAX_SLEEP_MS = 3600 * 1000;

// The snippet as steps: { text } to send, { wait } milliseconds to pause
function snippetSteps(s) {
  const steps = [];
  let lines = [];
  const flush = enter => {
    if (lines.length) steps.push({ text: lines.join('\n') + (enter ? '\n' : '') });
    lines = [];
  };
  for (const line of s.command.split('\n')) {
    const m = SLEEP_LINE.exec(line);
    if (!m) { lines.push(line); continue; }
    flush(true); // the lines before a sleep were each followed by Enter
    const ms = Math.min(MAX_SLEEP_MS, Math.round(parseFloat(m[1]) * (/^ms$/i.test(m[2] || '') ? 1 : 1000)));
    if (ms > 0) steps.push({ wait: ms });
  }
  flush(s.run);
  while (steps.length && steps[steps.length - 1].wait) steps.pop(); // nothing left to wait for
  return steps;
}

const hasSleeps = s => s.command.split('\n').some(line => SLEEP_LINE.test(line));

/* Variables: {{name}} asks for a value when the snippet runs; {{name=default}} offers a
   default. A name used more than once is asked for once. */

const VAR_RE = /\{\{\s*([^{}=]+?)\s*(?:=([^{}]*))?\}\}/g;
const lastValues = new Map(); // snippet id -> { name: value } typed last time (until the app closes)

// The variables in order of first appearance: [{ name, def }]
function snippetVars(command) {
  const seen = new Map();
  for (const m of command.matchAll(VAR_RE)) {
    const name = m[1];
    const def = (m[2] || '').trim();
    if (!seen.has(name)) seen.set(name, { name, def });
    else if (!seen.get(name).def) seen.get(name).def = def;
  }
  return [...seen.values()];
}

const fillVars = (command, values) => command.replace(VAR_RE, (m, name) => values[name] !== undefined ? values[name] : m);

// Ask for the snippet's variables. Returns the command with them filled in, or null if cancelled.
async function resolveVars(s) {
  const vars = snippetVars(s.command);
  if (!vars.length) return s.command;
  const remembered = lastValues.get(s.id) || {};
  const answers = await askFields({
    title: s.name,
    message: vars.length === 1 ? 'This snippet needs a value.' : 'This snippet needs some values.',
    okLabel: 'Run',
    fields: vars.map(v => ({
      label: v.name,
      value: remembered[v.name] !== undefined ? remembered[v.name] : v.def,
      placeholder: v.def
    }))
  });
  if (!answers) return null;
  const values = {};
  vars.forEach((v, i) => { values[v.name] = answers[i]; });
  lastValues.set(s.id, values);
  return fillVars(s.command, values);
}

const runs = new Map(); // pane -> { snippet, stop(), until, timer }

async function runSnippet(s) {
  const pane = activePane();
  if (!pane) { toast('Open a terminal first.', 'error'); return; }

  const current = runs.get(pane);
  if (current) {
    // Clicking the running snippet again stops it
    if (current.snippet.id === s.id) { current.stop(); toast(`Stopped "${s.name}".`); }
    else toast(`"${current.snippet.name}" is still running in this terminal. Click it to stop it.`, 'error');
    return;
  }
  if (pane.status !== 'connected') { toast('That terminal is not connected.', 'error'); return; }

  const command = await resolveVars(s);
  if (command === null) { pane.term.focus(); return; }
  // The terminal may have gone, or started another snippet, while the dialog was open
  if (pane.disposed || pane.status !== 'connected') { toast('That terminal is no longer connected.', 'error'); return; }
  if (runs.has(pane)) { toast(`"${runs.get(pane).snippet.name}" is still running in this terminal.`, 'error'); return; }

  const steps = snippetSteps({ ...s, command });
  if (!steps.some(step => step.wait)) {
    for (const step of steps) sendText(pane, step.text);
    pane.term.focus();
    return;
  }
  playSteps(pane, s, steps);
  pane.term.focus();
}

async function playSteps(pane, s, steps) {
  const sessionId = pane.sessionId;
  const run = { snippet: s, stopped: false, until: 0, wake: null };
  run.stop = () => { run.stopped = true; if (run.wake) run.wake(); };
  runs.set(pane, run);
  renderSnippets();

  for (const step of steps) {
    if (run.stopped) break;
    if (pane.disposed || pane.sessionId !== sessionId || pane.status !== 'connected') {
      if (!pane.disposed) toast(`"${s.name}" stopped: the terminal disconnected.`, 'error');
      break;
    }
    if (step.text !== undefined) {
      sendText(pane, step.text);
      continue;
    }
    run.until = Date.now() + step.wait;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, step.wait);
      run.wake = () => { clearTimeout(timer); resolve(); };
    });
    run.wake = null;
    run.until = 0;
  }

  runs.delete(pane);
  renderSnippets();
}

// Countdown on running snippets
setInterval(() => {
  if (!runs.size) return;
  document.querySelectorAll('#snip-list .snip-item.running').forEach(item => {
    const run = [...runs.values()].find(r => r.snippet.id === item.dataset.id);
    const label = item.querySelector('.snip-wait');
    if (!run || !label) return;
    label.textContent = run.until ? `waiting ${Math.max(0, Math.ceil((run.until - Date.now()) / 1000))}s` : 'running';
  });
}, 250);

/* ---------------- Folders ----------------
   A snippet's folder is just its `folder` name (no folder: unfiled). Folders with no
   snippets yet are remembered separately so a new folder can be filled by dragging. */

const cleanFolder = name => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);

const storedList = key => {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const storeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch {} };

const emptyFolders = new Set(storedList('snipEmptyFolders'));
const collapsedFolders = new Set(storedList('snipCollapsedFolders'));
const saveFolderState = () => {
  storeList('snipEmptyFolders', [...emptyFolders]);
  storeList('snipCollapsedFolders', [...collapsedFolders]);
};

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

function allFolders() {
  const names = new Set(emptyFolders);
  for (const s of snip.items) if (s.folder) names.add(s.folder);
  return [...names].sort(byName);
}

async function newFolder(moveSnippet) {
  const name = cleanFolder(await askText({ title: 'New folder', label: 'Folder name', okLabel: 'Create' }));
  if (!name) return null;
  collapsedFolders.delete(name);
  if (moveSnippet) moveToFolder(moveSnippet, name);
  else { emptyFolders.add(name); saveFolderState(); renderSnippets(); }
  return name;
}

function moveToFolder(s, folder) {
  const target = snip.items.find(x => x.id === s.id);
  if (!target) return;
  if (folder) target.folder = folder; else delete target.folder;
  if (folder) { emptyFolders.delete(folder); collapsedFolders.delete(folder); saveFolderState(); }
  persistSnippets();
}

async function renameFolder(oldName) {
  const name = cleanFolder(await askText({ title: 'Rename folder', label: 'Folder name', value: oldName, okLabel: 'Rename' }));
  if (!name || name === oldName) return;
  for (const s of snip.items) if (s.folder === oldName) s.folder = name; // a name already in use merges the two
  if (emptyFolders.delete(oldName)) emptyFolders.add(name);
  if (collapsedFolders.delete(oldName)) collapsedFolders.add(name);
  saveFolderState();
  persistSnippets();
}

// Keep the snippets (they move out of the folder), or delete them with it
async function removeFolder(name, deleteSnippets) {
  const inside = snip.items.filter(s => s.folder === name);
  if (deleteSnippets && inside.length) {
    const ok = await askConfirm({
      title: 'Delete folder',
      message: `Delete "${name}" and the ${inside.length} snippet${inside.length === 1 ? '' : 's'} in it?`
    });
    if (!ok) return;
    snip.items = snip.items.filter(s => s.folder !== name);
  } else {
    for (const s of inside) delete s.folder;
  }
  emptyFolders.delete(name);
  collapsedFolders.delete(name);
  saveFolderState();
  persistSnippets();
}

function toggleFolder(name) {
  if (collapsedFolders.has(name)) collapsedFolders.delete(name); else collapsedFolders.add(name);
  saveFolderState();
  renderSnippets();
}

function openFolderMenu(name, x, y) {
  const count = snip.items.filter(s => s.folder === name).length;
  showMenu(x, y, [
    { label: 'New snippet here…', action: () => openSnippetEditor(null, { folder: name }) },
    { label: 'Rename folder…', action: () => renameFolder(name) },
    { label: 'Share folder as .coosnip…', disabled: !count, action: () => exportCoosnip(snip.items.filter(s => s.folder === name), `${name.replace(/[^\w .()-]+/g, '_')}.coosnip`) },
    'sep',
    { label: count ? 'Remove folder (keep its snippets)' : 'Remove folder', action: () => removeFolder(name, false) },
    { label: 'Delete folder and its snippets…', danger: true, disabled: !count, action: () => removeFolder(name, true) }
  ]);
}

function openSnippetMenu(s, x, y) {
  const folders = allFolders().filter(f => f !== s.folder);
  showMenu(x, y, [
    { label: 'Run', action: () => runSnippet(s) },
    { label: 'Edit…', action: () => openSnippetEditor(s) },
    { label: 'Share as .coosnip…', action: () => shareSnippet(s) },
    { header: 'Move to folder' },
    ...(s.folder ? [{ label: 'No folder', action: () => moveToFolder(s, '') }] : []),
    ...folders.map(f => ({ label: f, action: () => moveToFolder(s, f) })),
    { label: 'New folder…', action: () => newFolder(s) },
    'sep',
    { label: 'Delete', danger: true, action: async () => {
      if (!await askConfirm({ title: 'Delete snippet', message: `Delete "${s.name}"?` })) return;
      snip.items = snip.items.filter(x => x.id !== s.id);
      persistSnippets();
    } }
  ]);
}

/* Drag a snippet onto a folder (or a snippet in it) to move it there; onto an unfiled
   snippet or the empty part of the list to take it out of its folder. */

const SNIP_MIME = 'application/x-cooterm-snippet';
let draggedSnippet = null;

function wireSnippetDrop(node, folder) {
  node.addEventListener('dragover', ev => {
    if (!draggedSnippet) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = 'move';
    clearSnipDropMarks();
    node.classList.add('snip-drop');
  });
  node.addEventListener('drop', ev => {
    if (!draggedSnippet) return;
    ev.preventDefault();
    ev.stopPropagation(); // not a file import
    const s = draggedSnippet;
    draggedSnippet = null;
    clearSnipDropMarks();
    if ((s.folder || '') !== folder) moveToFolder(s, folder);
  });
}

const clearSnipDropMarks = () => document.querySelectorAll('.snip-drop').forEach(n => n.classList.remove('snip-drop'));

function snippetItem(s, running) {
  const item = el('div', 'snip-item');
  item.dataset.id = s.id;
  item.title = s.command;
  item.draggable = true;
  if (running.has(s.id)) {
    item.classList.add('running');
    item.title += '\n\nRunning. Click to stop.';
  }

  const meta = el('div', 'snip-meta');
  const name = el('div', 'snip-name', s.name);
  if (s.run) name.appendChild(el('span', 'snip-badge', '↵'));
  if (hasSleeps(s)) name.appendChild(el('span', 'snip-badge', '⏱'));
  if (snippetVars(s.command).length) name.appendChild(el('span', 'snip-badge var', '{ }'));
  if (running.has(s.id)) name.appendChild(el('span', 'snip-wait', 'running'));
  meta.append(name, el('div', 'snip-cmd', s.command.replace(/\s*\n\s*/g, ' ⏎ ')));

  const actions = el('div', 'host-actions');
  const share = el('button', 'icon-btn');
  share.type = 'button';
  share.title = 'Share as a .coosnip file';
  share.innerHTML = iconSvg('share');
  share.addEventListener('click', ev => { ev.stopPropagation(); shareSnippet(s); });
  const edit = el('button', 'icon-btn', '✎');
  edit.type = 'button';
  edit.title = 'Edit';
  edit.addEventListener('click', ev => { ev.stopPropagation(); openSnippetEditor(s); });
  const del = el('button', 'icon-btn danger', '✕');
  del.type = 'button';
  del.title = 'Delete';
  del.addEventListener('click', async ev => {
    ev.stopPropagation();
    if (!await askConfirm({ title: 'Delete snippet', message: `Delete "${s.name}"?` })) return;
    snip.items = snip.items.filter(x => x.id !== s.id);
    persistSnippets();
  });
  actions.append(share, edit, del);

  item.append(meta, actions);
  item.addEventListener('click', () => runSnippet(s));
  item.addEventListener('contextmenu', ev => { ev.preventDefault(); openSnippetMenu(s, ev.clientX, ev.clientY); });
  item.addEventListener('dragstart', ev => {
    draggedSnippet = s;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(SNIP_MIME, s.id);
    item.classList.add('dragging');
  });
  item.addEventListener('dragend', () => {
    draggedSnippet = null;
    item.classList.remove('dragging');
    clearSnipDropMarks();
  });
  wireSnippetDrop(item, s.folder || '');
  return item;
}

function renderSnippets() {
  const list = $('#snip-list');
  const filter = $('#snip-search').value.trim().toLowerCase();
  list.innerHTML = '';

  const matches = s => !filter ||
    s.name.toLowerCase().includes(filter) ||
    s.command.toLowerCase().includes(filter) ||
    (s.folder || '').toLowerCase().includes(filter);
  const shown = snip.items.filter(matches);
  const folders = allFolders().filter(f => !filter || f.toLowerCase().includes(filter) || shown.some(s => s.folder === f));

  if (!shown.length && !folders.length) {
    list.appendChild(el('div', 'empty-note', snip.items.length ? 'No snippets match' : 'No snippets yet — add commands you type often.'));
    return;
  }

  const running = new Set([...runs.values()].map(r => r.snippet.id));

  // Folders first (A–Z), then the snippets that aren't in one
  for (const name of folders) {
    const inside = shown.filter(s => s.folder === name);
    const open = !!filter || !collapsedFolders.has(name); // a search opens every folder it matches

    const group = el('div', 'snip-folder' + (open ? ' open' : ''));
    const head = el('div', 'snip-folder-head');
    head.title = 'Click to open or close. Drag snippets here to file them. Right-click for options.';
    head.append(el('span', 'snip-chevron', '▸'));
    const icon = el('span', 'snip-folder-icon');
    icon.innerHTML = iconSvg('folder');
    head.append(icon, el('span', 'snip-folder-name', name), el('span', 'snip-folder-count', String(snip.items.filter(s => s.folder === name).length)));

    const add = el('button', 'icon-btn snip-folder-add', '+');
    add.type = 'button';
    add.title = `New snippet in "${name}"`;
    add.addEventListener('click', ev => { ev.stopPropagation(); openSnippetEditor(null, { folder: name }); });
    const more = el('button', 'icon-btn snip-folder-more');
    more.type = 'button';
    more.title = 'Folder options';
    more.innerHTML = iconSvg('more');
    more.addEventListener('click', ev => {
      ev.stopPropagation();
      const r = more.getBoundingClientRect();
      openFolderMenu(name, r.left, r.bottom + 4);
    });
    head.append(add, more);

    head.addEventListener('click', () => { if (!filter) toggleFolder(name); });
    head.addEventListener('contextmenu', ev => { ev.preventDefault(); openFolderMenu(name, ev.clientX, ev.clientY); });
    wireSnippetDrop(head, name);
    group.appendChild(head);

    if (open) {
      const body = el('div', 'snip-folder-body');
      if (!inside.length) body.appendChild(el('div', 'snip-folder-empty', filter ? 'No matches in this folder' : 'Empty — drag snippets here'));
      for (const s of inside) body.appendChild(snippetItem(s, running));
      wireSnippetDrop(body, name);
      group.appendChild(body);
    }
    list.appendChild(group);
  }

  for (const s of shown.filter(s => !s.folder)) list.appendChild(snippetItem(s, running));
}

function openSnippetEditor(s, { folder = '' } = {}) {
  snip.editingId = s ? s.id : null;
  $('#snip-title').textContent = s ? 'Edit snippet' : 'New snippet';
  $('#snip-name').value = s ? s.name : '';
  $('#snip-folder').value = s ? s.folder || '' : folder;
  const options = $('#snip-folder-list');
  options.innerHTML = '';
  for (const f of allFolders()) { const o = el('option'); o.value = f; options.appendChild(o); }
  $('#snip-cmd').value = s ? s.command : '';
  $('#snip-run').checked = s ? !!s.run : true;
  showEditorVars();
  $('#snip-backdrop').classList.remove('hidden');
  $('#snip-name').focus();
}

// "Will ask for: interface, vlan (default 10)" under the command box, as you type
function showEditorVars() {
  const vars = snippetVars($('#snip-cmd').value);
  const box = $('#snip-vars');
  box.classList.toggle('hidden', !vars.length);
  box.textContent = vars.length
    ? 'Will ask for: ' + vars.map(v => v.def ? `${v.name} (default ${v.def})` : v.name).join(', ')
    : '';
}

function closeSnippetEditor() {
  $('#snip-backdrop').classList.add('hidden');
}

function saveSnippet() {
  const command = $('#snip-cmd').value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!command.trim()) { $('#snip-cmd').focus(); return; }
  const name = $('#snip-name').value.trim() || command.split('\n')[0].slice(0, 40);
  const entry = { id: snip.editingId || 'sn' + Date.now(), name, command, run: $('#snip-run').checked };
  const folder = cleanFolder($('#snip-folder').value);
  if (folder) {
    entry.folder = folder;
    emptyFolders.delete(folder);
    collapsedFolders.delete(folder); // show where it went
    saveFolderState();
  }
  const idx = snip.items.findIndex(x => x.id === entry.id);
  if (idx >= 0) snip.items[idx] = entry;
  else snip.items.push(entry);
  persistSnippets();
  closeSnippetEditor();
}

$('#snip-new').addEventListener('click', () => openSnippetEditor(null));
$('#snip-new-folder').addEventListener('click', () => newFolder());
wireSnippetDrop($('#snip-list'), ''); // the empty part of the list: out of any folder
$('#snip-folder').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#snip-cmd').focus(); } });
$('#snip-search').addEventListener('input', renderSnippets);
$('#snip-cancel').addEventListener('click', closeSnippetEditor);
$('#snip-save').addEventListener('click', saveSnippet);
$('#snip-backdrop').addEventListener('mousedown', ev => { if (ev.target === ev.currentTarget) closeSnippetEditor(); });
$('#snip-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#snip-cmd').focus(); } });
$('#snip-cmd').addEventListener('input', showEditorVars);
$('#snip-cmd').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); saveSnippet(); } });

// Loaded the first time the panel is shown, so it costs nothing at startup
document.addEventListener('coo:side', () => {
  if (sideOpen === 'snippets' && !snip.loaded) loadSnippets();
});

// Edited in another window
window.api.onSnippetsChanged(() => { if (snip.loaded) loadSnippets(); });
