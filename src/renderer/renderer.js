/* global Terminal, FitAddon, WebLinksAddon */
/* Core: saved hosts, tabs and split panes, connecting/reconnecting, the host editor.
   Loaded after ui.js and settings.js; find.js, snippets.js and sftp.js build on it. */

const state = {
  hosts: [],
  tabs: [],            // { id, customTitle, tabEl, dotEl, titleEl, root, panes[], activePaneId }
  activeTabId: null,
  nextTabId: 1,
  nextPaneId: 1,
  editingHostId: null,
  modalType: 'ssh',
  modalAuth: 'password'
};

// A pane is one terminal + one session: { id, tab, cfg, term, fit, holder, termEl,
//   sessionId, status, connecting, disposed, log, sftpDir }
const bySession = new Map();     // sessionId -> pane
const pendingEvents = new Map(); // sessionId -> [fn(pane)] that arrived before the pane was mapped
const settledSessions = new Set(); // ids that were mapped or abandoned; late events for them are dropped

let detectedPorts = [];
let dataEpoch = 0; // bumped whenever any terminal receives output (find.js uses it)

const emit = name => document.dispatchEvent(new CustomEvent(name));

/* ---------------- Hosts ---------------- */

let hostsLoaded = false;

async function loadHosts() {
  state.hosts = await window.api.loadHosts();
  hostsLoaded = true;
  renderHosts();
}

async function persistHosts() {
  if (!hostsLoaded) return; // never overwrite the file before it has been read
  await window.api.saveHosts(state.hosts);
  renderHosts();
}

function hostSubtitle(h) {
  if (h.type === 'ssh') return `${h.username || '?'}@${h.host}:${h.port || 22}`;
  return `${h.path} @ ${h.baudRate || 115200} ${h.dataBits || 8}${(h.parity || 'none')[0].toUpperCase()}${h.stopBits || 1}`;
}

function renderHosts() {
  const filter = $('#search').value.trim().toLowerCase();
  const sshList = $('#ssh-list');
  const serialList = $('#serial-list');
  sshList.innerHTML = '';
  serialList.innerHTML = '';

  const matches = h =>
    !filter ||
    (h.name || '').toLowerCase().includes(filter) ||
    hostSubtitle(h).toLowerCase().includes(filter);

  for (const h of state.hosts.filter(matches)) {
    const item = document.createElement('div');
    item.className = 'host-item';

    const icon = document.createElement('div');
    icon.className = 'host-icon' + (h.type === 'serial' ? ' serial' : '');
    icon.textContent = h.type === 'serial' ? '⌁' : '>_';

    const meta = document.createElement('div');
    meta.className = 'host-meta';
    const name = document.createElement('div');
    name.className = 'host-name';
    name.textContent = h.name || hostSubtitle(h);
    const sub = document.createElement('div');
    sub.className = 'host-sub';
    sub.textContent = hostSubtitle(h);
    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'host-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', ev => { ev.stopPropagation(); openModal(h); });
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Delete';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async ev => {
      ev.stopPropagation();
      const label = h.name || hostSubtitle(h);
      if (!await askConfirm({ title: 'Delete host', message: `Delete "${label}"? Open sessions stay connected.` })) return;
      state.hosts = state.hosts.filter(x => x.id !== h.id);
      persistHosts();
    });
    actions.append(editBtn, delBtn);

    item.append(icon, meta, actions);
    item.addEventListener('click', () => connect(h));
    (h.type === 'serial' ? serialList : sshList).appendChild(item);
  }

  if (!sshList.children.length) sshList.innerHTML = '<div class="empty-note">No SSH hosts yet</div>';
  if (!serialList.children.length) serialList.innerHTML = '<div class="empty-note">No saved serial connections</div>';
}

/* ---------------- Local shells ---------------- */

const LOCAL_SHELLS = [
  { type: 'local', name: 'PowerShell', shell: 'powershell.exe', badge: 'PS' },
  { type: 'local', name: 'Command Prompt', shell: 'cmd.exe', badge: 'C:\\' }
];

function renderLocalShells() {
  const list = $('#local-list');
  list.innerHTML = '';
  for (const sh of LOCAL_SHELLS) {
    const item = document.createElement('div');
    item.className = 'host-item';

    const icon = document.createElement('div');
    icon.className = 'host-icon local';
    icon.textContent = sh.badge;

    const meta = document.createElement('div');
    meta.className = 'host-meta';
    const name = document.createElement('div');
    name.className = 'host-name';
    name.textContent = sh.name;
    const sub = document.createElement('div');
    sub.className = 'host-sub';
    sub.textContent = sh.shell;
    meta.append(name, sub);

    item.append(icon, meta);
    item.addEventListener('click', () => connect(sh));
    list.appendChild(item);
  }
}

/* ---------------- Detected serial ports ---------------- */

const portConfig = p => ({ type: 'serial', name: p.path, path: p.path, baudRate: 115200 });

async function refreshPorts() {
  const list = $('#ports-list');
  const ports = await window.api.listPorts();
  detectedPorts = ports;
  list.innerHTML = '';
  if (!ports.length) {
    list.innerHTML = '<div class="empty-note">No serial ports detected</div>';
    return;
  }
  for (const p of ports) {
    const item = document.createElement('div');
    item.className = 'host-item';
    item.title = 'Connect at 115200 8N1';

    const icon = document.createElement('div');
    icon.className = 'host-icon port';
    icon.textContent = '⌁';

    const meta = document.createElement('div');
    meta.className = 'host-meta';
    const name = document.createElement('div');
    name.className = 'host-name';
    name.textContent = p.path;
    const sub = document.createElement('div');
    sub.className = 'host-sub';
    sub.textContent = p.friendlyName || p.manufacturer || 'Serial device';
    meta.append(name, sub);

    const actions = document.createElement('div');
    actions.className = 'host-actions';
    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'icon-btn';
    cfgBtn.title = 'Configure & save';
    cfgBtn.textContent = '⚙';
    cfgBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      openModal({ type: 'serial', path: p.path });
    });
    actions.append(cfgBtn);

    item.append(icon, meta, actions);
    item.addEventListener('click', () => connect(portConfig(p)));
    list.appendChild(item);
  }
}

/* ---------------- Tabs & panes ---------------- */

const allPanes = () => state.tabs.flatMap(t => t.panes);
const activeTab = () => state.tabs.find(t => t.id === state.activeTabId) || null;
const tabActivePane = tab => tab.panes.find(p => p.id === tab.activePaneId) || tab.panes[0] || null;
function activePane() {
  const tab = activeTab();
  return tab ? tabActivePane(tab) : null;
}

function connectTarget(cfg) {
  if (cfg.type === 'serial') return `${cfg.path} @ ${cfg.baudRate || 115200}`;
  if (cfg.type === 'local') return cfg.shell || 'powershell.exe';
  return `${cfg.username || '?'}@${cfg.host}:${cfg.port || 22}`;
}

const paneTitle = pane => pane.cfg.name || connectTarget(pane.cfg);

function tabTitle(tab) {
  if (tab.customTitle) return tab.customTitle;
  const pane = tabActivePane(tab);
  return pane ? paneTitle(pane) : '';
}

function updateTabUi(tab) {
  const pane = tabActivePane(tab);
  if (!tab.titleEl.isContentEditable) tab.titleEl.textContent = tabTitle(tab);
  tab.dotEl.className = 'tab-dot ' + (pane ? pane.status : 'closed');
  tab.tabEl.classList.toggle('logging', tab.panes.some(p => p.log));
  tab.tabEl.title = tab.panes.map(p => `${paneTitle(p)} — ${p.status}${p.log ? ` — logging to ${p.log.file}` : ''}`).join('\n');
  tab.root.classList.toggle('multi', tab.panes.length > 1);
  for (const p of tab.panes) p.holder.classList.toggle('focused', p === pane);
}

// Toolbar buttons reflect the focused pane
function updateChrome() {
  const pane = activePane();
  $('#tb-split-right').disabled = !pane;
  $('#tb-split-down').disabled = !pane;
  $('#tb-log').disabled = !pane;
  $('#tb-log').classList.toggle('recording', !!(pane && pane.log));
  $('#tb-log').title = pane && pane.log ? `Logging to ${pane.log.file} — click to stop` : 'Log this session to a file';
  $('#welcome').style.display = state.tabs.length ? 'none' : 'flex';
}

function setPaneStatus(pane, status) {
  pane.status = status;
  updateTabUi(pane.tab);
  if (pane === activePane()) updateChrome();
  emit('coo:panestate');
}

function fitPane(pane) {
  if (pane.disposed || !pane.holder.clientWidth || !pane.holder.clientHeight) return;
  try { pane.fit.fit(); } catch {}
}

function scheduleFit(pane) {
  if (pane.fitQueued) return;
  pane.fitQueued = true;
  requestAnimationFrame(() => {
    pane.fitQueued = false;
    fitPane(pane);
  });
}

function focusPane(pane, { keyboard = true } = {}) {
  const tab = pane.tab;
  const changed = tab.activePaneId !== pane.id;
  tab.activePaneId = pane.id;
  updateTabUi(tab);
  if (tab.id === state.activeTabId) {
    updateChrome();
    if (keyboard) pane.term.focus();
    if (changed) emit('coo:activepane');
  }
}

function activateTab(tabId, { keyboard = true } = {}) {
  const changed = state.activeTabId !== tabId;
  state.activeTabId = tabId;
  for (const t of state.tabs) {
    const active = t.id === tabId;
    t.tabEl.classList.toggle('active', active);
    t.root.classList.toggle('active', active);
    if (active) {
      requestAnimationFrame(() => {
        for (const p of t.panes) fitPane(p);
        const pane = tabActivePane(t);
        if (pane && keyboard && state.activeTabId === t.id) pane.term.focus();
      });
      t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  updateChrome();
  if (changed) emit('coo:activepane');
}

function createTab() {
  const id = state.nextTabId++;

  const root = el('div', 'tab-root');
  $('#terminals').appendChild(root);

  const tabEl = el('div', 'tab');
  tabEl.draggable = true;
  const dotEl = el('div', 'tab-dot connecting');
  const titleEl = el('div', 'tab-title');
  const closeBtn = el('button', 'tab-close', '✕');
  closeBtn.title = 'Close tab';
  tabEl.append(dotEl, titleEl, closeBtn);
  $('#tabbar').appendChild(tabEl);

  const tab = { id, customTitle: '', tabEl, dotEl, titleEl, root, panes: [], activePaneId: null };

  tabEl.addEventListener('click', () => { if (state.activeTabId !== id) activateTab(id); });
  tabEl.addEventListener('auxclick', ev => { if (ev.button === 1) closeTab(tab); });
  tabEl.addEventListener('dblclick', ev => { if (ev.target !== closeBtn) renameTab(tab); });
  tabEl.addEventListener('contextmenu', ev => { ev.preventDefault(); openTabMenu(tab, ev.clientX, ev.clientY); });
  closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeTab(tab); });
  wireTabDrag(tab);

  state.tabs.push(tab);
  return tab;
}

function createPane(tab, cfg) {
  const holder = el('div', 'pane');
  const termEl = el('div', 'pane-term');
  holder.appendChild(termEl);
  holder.style.background = currentTheme().background;

  const term = new Terminal({ ...terminalOptions(), allowProposedApi: true });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  // Links open in the default browser (never inside the app window)
  term.loadAddon(new WebLinksAddon.WebLinksAddon((ev, uri) => window.api.openExternal(uri)));

  const pane = {
    id: state.nextPaneId++, tab, cfg, term, fit, holder, termEl,
    sessionId: null, status: 'connecting', connecting: false, disposed: false,
    log: null, sftpDir: null, fitQueued: false
  };

  term.onData(data => sendInput(pane, data));
  term.onResize(({ cols, rows }) => { if (pane.sessionId) window.api.resize(pane.sessionId, cols, rows); });

  holder.addEventListener('mousedown', () => { if (tab.activePaneId !== pane.id) focusPane(pane, { keyboard: false }); }, true);
  holder.addEventListener('contextmenu', ev => {
    // Leave right-click alone when a full-screen app is tracking the mouse, or if turned off
    if (!settings.rightClickPaste || (term.modes.mouseTrackingMode !== 'none' && !ev.shiftKey)) return;
    ev.preventDefault();
    if (term.hasSelection()) { copySelection(pane); dropSelection(term); }
    else pasteInto(pane);
  });

  pane.resizeObserver = new ResizeObserver(() => scheduleFit(pane));
  pane.resizeObserver.observe(holder);

  tab.panes.push(pane);
  return pane;
}

// xterm's DOM renderer remembers the last drawn selection and paints it again on the
// next resize even after clearSelection(). Replacing it with an empty selection
// leaves nothing behind to repaint.
function dropSelection(term) {
  term.clearSelection();
  term.select(0, 0, 0);
}

function copySelection(pane) {
  if (pane.term.hasSelection()) navigator.clipboard.writeText(pane.term.getSelection()).catch(() => {});
}

function pasteInto(pane) {
  // term.paste() normalises line endings and honours bracketed-paste mode
  navigator.clipboard.readText().then(text => { if (text && !pane.disposed) pane.term.paste(text); }).catch(() => {});
}

/* Splits: a pane's holder is replaced by a .split container holding the old pane, a
   draggable divider and the new pane. Closing a pane collapses its container again. */

function splitPane(pane, dir, cfg) {
  if (!pane || pane.disposed) return;
  const tab = pane.tab;
  const split = el('div', 'split ' + (dir === 'down' ? 'col' : 'row'));
  split.style.flex = pane.holder.style.flex || '1 1 0px';
  pane.holder.replaceWith(split);
  pane.holder.style.flex = '1 1 0px';

  const fresh = createPane(tab, { ...cfg });
  fresh.holder.style.flex = '1 1 0px';
  const divider = el('div', 'divider');
  split.append(pane.holder, divider, fresh.holder);
  wireDivider(divider);

  fresh.term.open(fresh.termEl);
  fitPane(pane);
  fitPane(fresh);
  focusPane(fresh);
  attemptConnection(fresh);
}

function wireDivider(divider) {
  divider.addEventListener('mousedown', ev => {
    ev.preventDefault();
    const split = divider.parentElement;
    const a = divider.previousElementSibling;
    const b = divider.nextElementSibling;
    const horizontal = split.classList.contains('row');
    const rect = split.getBoundingClientRect();
    document.body.classList.add('dragging-divider', horizontal ? 'drag-col' : 'drag-row');
    const move = e => {
      let r = horizontal ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      r = Math.min(0.9, Math.max(0.1, r));
      a.style.flex = `${r} 1 0px`;
      b.style.flex = `${1 - r} 1 0px`;
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging-divider', 'drag-col', 'drag-row');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  divider.addEventListener('dblclick', () => {
    divider.previousElementSibling.style.flex = '1 1 0px';
    divider.nextElementSibling.style.flex = '1 1 0px';
  });
}

function closePane(pane) {
  if (pane.disposed) return;
  pane.disposed = true;
  const tab = pane.tab;

  if (pane.sessionId) {
    bySession.delete(pane.sessionId);
    window.api.closeSession(pane.sessionId);
    pane.sessionId = null;
  }
  pane.resizeObserver.disconnect();

  const parent = pane.holder.parentElement;
  pane.holder.remove();
  pane.term.dispose();
  if (parent && parent.classList.contains('split')) {
    const survivor = [...parent.children].find(c => !c.classList.contains('divider'));
    if (survivor) {
      survivor.style.flex = parent.style.flex || '1 1 0px';
      parent.replaceWith(survivor);
    }
  }

  tab.panes = tab.panes.filter(p => p !== pane);
  emit('coo:panestate');

  if (!tab.panes.length) {
    removeTab(tab);
    return;
  }
  if (tab.activePaneId === pane.id) {
    tab.activePaneId = tab.panes[tab.panes.length - 1].id;
    if (tab.id === state.activeTabId) emit('coo:activepane');
  }
  updateTabUi(tab);
  if (tab.id === state.activeTabId) {
    updateChrome();
    const next = tabActivePane(tab);
    if (next) next.term.focus();
  }
}

function removeTab(tab) {
  const index = state.tabs.indexOf(tab);
  tab.root.remove();
  tab.tabEl.remove();
  state.tabs = state.tabs.filter(t => t !== tab);
  if (state.activeTabId === tab.id) {
    const next = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(next ? next.id : null);
  } else {
    updateChrome();
  }
}

function closeTab(tab) {
  for (const pane of [...tab.panes]) closePane(pane);
}

function openTab(cfg) {
  const tab = createTab();
  const pane = createPane(tab, { ...cfg });
  pane.holder.style.flex = '1 1 0px';
  tab.root.appendChild(pane.holder);
  tab.activePaneId = pane.id;
  activateTab(tab.id);
  pane.term.open(pane.termEl);
  fitPane(pane);
  updateTabUi(tab);
  pane.term.focus();
  return pane;
}

function stepTab(delta) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.findIndex(t => t.id === state.activeTabId);
  activateTab(state.tabs[(i + delta + state.tabs.length) % state.tabs.length].id);
}

/* Tab rename (double-click) */

function renameTab(tab) {
  const title = tab.titleEl;
  if (title.isContentEditable) return;
  title.contentEditable = 'plaintext-only';
  title.classList.add('editing');
  title.textContent = tabTitle(tab);
  tab.tabEl.draggable = false;
  title.focus();
  document.getSelection().selectAllChildren(title);

  const finish = commit => {
    title.removeEventListener('keydown', onKey);
    title.removeEventListener('blur', onBlur);
    const text = title.textContent.replace(/\s+/g, ' ').trim();
    title.contentEditable = 'false';
    title.classList.remove('editing');
    tab.tabEl.draggable = true;
    // An empty name goes back to the automatic title
    if (commit) tab.customTitle = text && text !== paneTitle(tabActivePane(tab) || { cfg: {} }) ? text : '';
    updateTabUi(tab);
    const pane = tabActivePane(tab);
    if (pane && tab.id === state.activeTabId) pane.term.focus();
  };
  const onKey = ev => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  title.addEventListener('keydown', onKey);
  title.addEventListener('blur', onBlur);
}

/* Tab reorder (drag and drop) */

let draggedTab = null;

function wireTabDrag(tab) {
  const tabEl = tab.tabEl;
  tabEl.addEventListener('dragstart', ev => {
    draggedTab = tab;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', tabTitle(tab));
    tabEl.classList.add('dragging');
  });
  tabEl.addEventListener('dragend', () => {
    draggedTab = null;
    tabEl.classList.remove('dragging');
    clearDropMarks();
  });
  tabEl.addEventListener('dragover', ev => {
    if (!draggedTab || draggedTab === tab) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const r = tabEl.getBoundingClientRect();
    const after = ev.clientX > r.left + r.width / 2;
    clearDropMarks();
    tabEl.classList.add(after ? 'drop-after' : 'drop-before');
  });
  tabEl.addEventListener('drop', ev => {
    if (!draggedTab || draggedTab === tab) return;
    ev.preventDefault();
    const after = tabEl.classList.contains('drop-after');
    clearDropMarks();
    const moved = draggedTab;
    state.tabs = state.tabs.filter(t => t !== moved);
    const at = state.tabs.indexOf(tab) + (after ? 1 : 0);
    state.tabs.splice(at, 0, moved);
    if (after) tabEl.after(moved.tabEl); else tabEl.before(moved.tabEl);
  });
}

function clearDropMarks() {
  document.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
}

/* Menus */

function openTabMenu(tab, x, y) {
  const pane = tabActivePane(tab);
  showMenu(x, y, [
    { label: 'Rename', action: () => renameTab(tab) },
    { label: 'Duplicate', disabled: !pane || pane.cfg.type === 'serial', action: () => connect(pane.cfg) },
    'sep',
    { label: 'Split right…', action: () => { activateTab(tab.id); openSplitMenu('right', x, y); } },
    { label: 'Split down…', action: () => { activateTab(tab.id); openSplitMenu('down', x, y); } },
    'sep',
    { label: pane && pane.log ? 'Stop logging' : 'Log to file…', disabled: !pane, action: () => { activateTab(tab.id); toggleLog(tabActivePane(tab)); } },
    'sep',
    { label: 'Close', action: () => closeTab(tab) },
    { label: 'Close other tabs', disabled: state.tabs.length < 2, action: () => { for (const t of [...state.tabs]) if (t !== tab) closeTab(t); } }
  ]);
}

// What to open in the new pane: a copy of the current session, or anything from the sidebar
function openSplitMenu(dir, x, y) {
  const pane = activePane();
  if (!pane) return;
  const go = cfg => () => splitPane(activePane() || pane, dir, cfg);
  const items = [];
  if (pane.cfg.type !== 'serial') items.push({ label: `Duplicate ${paneTitle(pane)}`, action: go(pane.cfg) }, 'sep');
  items.push({ header: 'Local' });
  for (const sh of LOCAL_SHELLS) items.push({ label: sh.name, action: go(sh) });
  const ssh = state.hosts.filter(h => h.type === 'ssh');
  if (ssh.length) {
    items.push({ header: 'SSH hosts' });
    for (const h of ssh) items.push({ label: h.name || hostSubtitle(h), action: go(h) });
  }
  const serial = state.hosts.filter(h => h.type === 'serial');
  const loosePorts = detectedPorts.filter(p => !serial.some(h => h.path === p.path));
  if (serial.length || loosePorts.length) {
    items.push({ header: 'Serial' });
    for (const h of serial) items.push({ label: h.name || hostSubtitle(h), action: go(h) });
    for (const p of loosePorts) items.push({ label: `${p.path} @ 115200`, action: go(portConfig(p)) });
  }
  showMenu(x, y, items);
}

// Keyboard split: duplicate the session (a serial port can only be opened once, so offer the menu)
function splitActive(dir) {
  const pane = activePane();
  if (!pane) return;
  if (pane.cfg.type === 'serial') {
    const r = pane.holder.getBoundingClientRect();
    openSplitMenu(dir, r.left + 40, r.top + 40);
  } else {
    splitPane(pane, dir, pane.cfg);
  }
}

/* ---------------- Input ---------------- */

function sendInput(pane, data) {
  if (!pane.sessionId || pane.status !== 'connected') {
    // A dead pane comes back with Enter
    if (pane.status === 'closed' && !pane.connecting && (data === '\r' || data === '\n')) reconnect(pane);
    return;
  }

  if (pane.cfg.type === 'serial') {
    // Map Enter to the configured line ending
    const le = { cr: '\r', lf: '\n', crlf: '\r\n' }[pane.cfg.lineEnding || 'cr'];
    const out = data.replace(/\r/g, le);
    window.api.input(pane.sessionId, out);
    if (pane.cfg.localEcho) {
      pane.term.write(data.replace(/\r/g, '\r\n').replace(/\x7f/g, '\b \b'));
    }
  } else {
    window.api.input(pane.sessionId, data);
  }
}

// Send text exactly as typed (used by snippets). Newlines become Enter.
function sendText(pane, text) {
  sendInput(pane, text.replace(/\r\n|\n/g, '\r'));
}

/* ---------------- Session logging ---------------- */

async function toggleLog(pane) {
  if (!pane) return;
  if (pane.log) {
    if (pane.sessionId) await window.api.logStop(pane.sessionId);
    const file = pane.log.file;
    pane.log = null;
    toast(`Logging stopped — ${file}`);
  } else {
    if (!pane.sessionId || pane.status !== 'connected') {
      toast('Connect the session before starting a log.', 'error');
      return;
    }
    const res = await window.api.logStart({ id: pane.sessionId, timestamps: settings.logTimestamps, title: paneTitle(pane) });
    if (res.ok) {
      pane.log = { file: res.file };
      toast(`Logging to ${res.file}`);
    } else if (!res.cancelled) {
      toast(`Could not start logging: ${res.error}`, 'error');
    }
  }
  if (!pane.disposed) updateTabUi(pane.tab);
  updateChrome();
}

// After a reconnect the new session carries on in the same file
async function resumeLog(pane) {
  if (!pane.log || !pane.sessionId) return;
  const res = await window.api.logStart({
    id: pane.sessionId, file: pane.log.file, append: true,
    timestamps: settings.logTimestamps, title: paneTitle(pane)
  });
  if (!res.ok) {
    pane.log = null;
    toast(`Logging stopped: ${res.error || 'could not reopen the log file'}`, 'error');
    if (!pane.disposed) updateTabUi(pane.tab);
    updateChrome();
  }
}

/* ---------------- Connection popup ---------------- */

let currentAttempt = null; // { connectId, pane, cancelled, failed, reconnect }
let nextConnectId = 1;

function openConnectPopup(cfg) {
  $('#connect-title').textContent = `Connecting to ${cfg.name || connectTarget(cfg)}`;
  const status = $('#connect-status');
  status.textContent = connectTarget(cfg);
  status.classList.remove('error');
  $('#connect-log').innerHTML = '';
  $('#connect-spinner').classList.remove('hidden');
  $('#connect-fail-icon').classList.add('hidden');
  $('#btn-connect-retry').classList.add('hidden');
  $('#btn-connect-cancel').textContent = 'Cancel';
  $('#connect-backdrop').classList.remove('hidden');
}

function closeConnectPopup() {
  const pane = currentAttempt && currentAttempt.pane;
  $('#connect-backdrop').classList.add('hidden');
  currentAttempt = null;
  // Hand the keyboard back to the terminal (so Enter can retry a failed connection)
  if (pane && !pane.disposed && pane === activePane()) pane.term.focus();
}

function connectPopupFailed(error) {
  $('#connect-spinner').classList.add('hidden');
  $('#connect-fail-icon').classList.remove('hidden');
  const status = $('#connect-status');
  status.textContent = error;
  status.classList.add('error');
  $('#btn-connect-retry').classList.remove('hidden');
  $('#btn-connect-cancel').textContent = 'Close';
}

function appendConnectLog(level, message) {
  const log = $('#connect-log');
  const line = document.createElement('div');
  line.className = 'log-line ' + level;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date().toLocaleTimeString('en-GB');
  line.appendChild(time);
  line.appendChild(document.createTextNode(message));
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

window.api.onLog(({ connectId, level, message }) => {
  if (!currentAttempt || currentAttempt.connectId !== connectId) return;
  appendConnectLog(level, message);
  if (level !== 'debug' && !currentAttempt.failed) {
    $('#connect-status').textContent = message;
  }
});

/* ---------------- Connecting ---------------- */

const RECONNECT_HINT = '\x1b[90mPress \x1b[97mEnter\x1b[90m to reconnect.\x1b[0m\r\n';

function connect(cfg) {
  const pane = openTab(cfg);
  attemptConnection(pane);
  return pane;
}

function reconnect(pane) {
  if (pane.disposed || pane.connecting || pane.status === 'connected') return;
  attemptConnection(pane, { reconnect: true });
}

async function attemptConnection(pane, { reconnect: isReconnect = false } = {}) {
  const cfg = pane.cfg;
  const connectId = 'c' + nextConnectId++;
  const attempt = { connectId, pane, cancelled: false, failed: false, reconnect: isReconnect };
  const showProgress = cfg.type !== 'local'; // local shells spawn instantly

  pane.connecting = true;
  if (showProgress) {
    currentAttempt = attempt;
    openConnectPopup(cfg);
    pane.term.write(`\x1b[90mConnecting to ${connectTarget(cfg)}...\x1b[0m\r\n`);
  }
  setPaneStatus(pane, 'connecting');

  const res = await window.api.createSession({
    ...cfg,
    connectId,
    cols: pane.term.cols,
    rows: pane.term.rows
  });
  pane.connecting = false;

  if (attempt.cancelled || pane.disposed) {
    // Cancelled (or the pane was closed) while the attempt was in flight; clean up if it won anyway
    if (res.ok) {
      settledSessions.add(res.id);
      pendingEvents.delete(res.id);
      window.api.closeSession(res.id);
    }
    if (!pane.disposed) {
      setPaneStatus(pane, 'closed');
      pane.term.write('\x1b[90mCancelled. \x1b[0m' + RECONNECT_HINT);
    }
    return;
  }

  if (!res.ok) {
    attempt.failed = true;
    setPaneStatus(pane, 'closed');
    pane.term.write(`\x1b[91mConnection failed: ${res.error}\x1b[0m\r\n` + RECONNECT_HINT);
    if (currentAttempt === attempt) connectPopupFailed(res.error);
    return;
  }

  if (pane.sessionId) bySession.delete(pane.sessionId);
  pane.sessionId = res.id;
  bySession.set(res.id, pane);
  settledSessions.add(res.id);
  setPaneStatus(pane, 'connected');
  if (showProgress) pane.term.write('\x1b[2K\x1b[1A\x1b[2K\r'); // clear the "Connecting..." line

  const backlog = pendingEvents.get(res.id);
  if (backlog) {
    pendingEvents.delete(res.id);
    for (const fn of backlog) fn(pane);
  }
  window.api.resize(res.id, pane.term.cols, pane.term.rows);
  if (currentAttempt === attempt) closeConnectPopup();
  resumeLog(pane);
  if (pane === activePane()) pane.term.focus();
}

// Events can beat the createSession() reply; hold them until the pane is known
function withPane(sessionId, fn) {
  const pane = bySession.get(sessionId);
  if (pane) return fn(pane);
  if (settledSessions.has(sessionId)) return; // closed pane or abandoned attempt
  if (!pendingEvents.has(sessionId)) pendingEvents.set(sessionId, []);
  pendingEvents.get(sessionId).push(fn);
}

window.api.onData(({ id, data }) => {
  const bytes = new Uint8Array(data);
  withPane(id, pane => {
    dataEpoch++;
    pane.term.write(bytes);
  });
});

window.api.onStatus(({ id, status, level, message }) => {
  withPane(id, pane => {
    if (status === 'closed') {
      if (pane.sessionId !== id) return;
      bySession.delete(id);
      pane.sessionId = null;
      setPaneStatus(pane, 'closed');
      pane.term.write(`\r\n\x1b[90m[Session closed${message ? ` — ${message}` : ''}]\x1b[0m\r\n` + RECONNECT_HINT);
    } else if (status === 'error') {
      pane.term.write(`\r\n\x1b[91m[Error: ${message}]\x1b[0m\r\n`);
    } else if (status === 'notice') {
      pane.term.write(`\r\n\x1b[${level === 'error' ? '91' : '90'}m[${message}]\x1b[0m\r\n`);
    }
  });
});

/* ---------------- Host editor modal ---------------- */

function setModalType(type) {
  state.modalType = type;
  document.querySelectorAll('.seg-btn[data-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.type === type));
  document.querySelectorAll('.type-group').forEach(g =>
    g.classList.toggle('hidden', g.dataset.group !== type));
}

function setModalAuth(auth) {
  state.modalAuth = auth;
  document.querySelectorAll('.seg-btn[data-auth]').forEach(b =>
    b.classList.toggle('active', b.dataset.auth === auth));
  document.querySelectorAll('.auth-group').forEach(g =>
    g.classList.toggle('hidden', g.dataset.group !== auth));
}

async function populateSerialPortSelect(selected) {
  const sel = $('#f-serial-port');
  sel.innerHTML = '';
  const ports = await window.api.listPorts();
  for (const p of ports) {
    const opt = document.createElement('option');
    opt.value = p.path;
    opt.textContent = p.friendlyName ? `${p.path} — ${p.friendlyName}` : p.path;
    sel.appendChild(opt);
  }
  if (selected && ![...sel.options].some(o => o.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    opt.textContent = selected + ' (not detected)';
    sel.appendChild(opt);
  }
  if (selected) sel.value = selected;
}

/* Port forwarding rules (SSH hosts) */

function addForwardRow(rule = {}) {
  const row = el('div', 'fwd-row');

  const type = el('select', 'fwd-type');
  for (const [value, label] of [['local', 'Local'], ['remote', 'Remote'], ['dynamic', 'SOCKS']]) {
    const opt = el('option', '', label);
    opt.value = value;
    type.appendChild(opt);
  }
  type.value = rule.type || 'local';

  const src = el('input', 'fwd-src');
  src.type = 'number'; src.min = 1; src.max = 65535;
  src.value = rule.srcPort || '';

  const arrow = el('span', 'fwd-arrow', '→');

  const host = el('input', 'fwd-host');
  host.type = 'text'; host.spellcheck = false;
  host.placeholder = 'destination host';
  host.value = rule.dstHost || '';

  const dst = el('input', 'fwd-dst');
  dst.type = 'number'; dst.min = 1; dst.max = 65535;
  dst.placeholder = 'port';
  dst.value = rule.dstPort || '';

  const remove = el('button', 'icon-btn danger', '✕');
  remove.type = 'button';
  remove.title = 'Remove rule';
  remove.addEventListener('click', () => row.remove());

  const sync = () => {
    const dynamic = type.value === 'dynamic';
    for (const node of [arrow, host, dst]) node.classList.toggle('invisible', dynamic);
    src.placeholder = type.value === 'remote' ? 'server port' : 'local port';
    row.title = {
      local: 'Local: a port on this PC that reaches the destination through the server',
      remote: 'Remote: a port on the server that reaches a destination from this PC',
      dynamic: 'SOCKS: a SOCKS5 proxy on this PC that sends traffic through the server'
    }[type.value];
  };
  type.addEventListener('change', sync);
  sync();

  row.append(type, src, arrow, host, dst, remove);
  $('#f-forwards').appendChild(row);
  return row;
}

function collectForwards() {
  const rules = [];
  for (const row of document.querySelectorAll('#f-forwards .fwd-row')) {
    const type = row.querySelector('.fwd-type').value;
    const srcPort = parseInt(row.querySelector('.fwd-src').value, 10);
    const dstHost = row.querySelector('.fwd-host').value.trim();
    const dstPort = parseInt(row.querySelector('.fwd-dst').value, 10);
    const portOk = n => n >= 1 && n <= 65535;
    if (!portOk(srcPort)) { row.querySelector('.fwd-src').focus(); return null; }
    if (type === 'dynamic') { rules.push({ type, srcPort }); continue; }
    if (!dstHost) { row.querySelector('.fwd-host').focus(); return null; }
    if (!portOk(dstPort)) { row.querySelector('.fwd-dst').focus(); return null; }
    rules.push({ type, srcPort, dstHost, dstPort });
  }
  return rules;
}

function openModal(host) {
  state.editingHostId = host && host.id ? host.id : null;
  $('#modal-title').textContent = state.editingHostId ? 'Edit Host' : 'New Host';

  const h = host || {};
  setModalType(h.type || 'ssh');
  setModalAuth(h.auth || 'password');

  $('#f-name').value = h.name || '';
  $('#f-host').value = h.host || '';
  $('#f-port').value = h.port || 22;
  $('#f-username').value = h.username || '';
  $('#f-password').value = h.password || '';
  $('#f-keypath').value = h.keyPath || '';
  $('#f-passphrase').value = h.passphrase || '';
  $('#f-forwards').innerHTML = '';
  for (const rule of h.forwards || []) addForwardRow(rule);

  populateSerialPortSelect(h.path || null);
  $('#f-baud').value = h.baudRate || 115200;
  $('#f-databits').value = h.dataBits || 8;
  $('#f-parity').value = h.parity || 'none';
  $('#f-stopbits').value = h.stopBits || 1;
  $('#f-flow').value = h.flow || 'none';
  $('#f-lineending').value = h.lineEnding || 'cr';
  $('#f-localecho').checked = !!h.localEcho;

  $('#modal-backdrop').classList.remove('hidden');
  $('#f-name').focus();
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
}

function collectForm() {
  const type = state.modalType;
  const base = {
    id: state.editingHostId || 'h' + Date.now(),
    type,
    name: $('#f-name').value.trim()
  };

  if (type === 'ssh') {
    const host = $('#f-host').value.trim();
    if (!host) { $('#f-host').focus(); return null; }
    const forwards = collectForwards();
    if (!forwards) return null;
    return {
      ...base,
      host,
      port: parseInt($('#f-port').value, 10) || 22,
      username: $('#f-username').value.trim(),
      auth: state.modalAuth,
      password: $('#f-password').value,
      keyPath: $('#f-keypath').value.trim(),
      passphrase: $('#f-passphrase').value,
      forwards
    };
  }

  const portPath = $('#f-serial-port').value;
  if (!portPath) { $('#f-serial-port').focus(); return null; }
  return {
    ...base,
    path: portPath,
    baudRate: parseInt($('#f-baud').value, 10) || 115200,
    dataBits: parseInt($('#f-databits').value, 10) || 8,
    parity: $('#f-parity').value,
    stopBits: parseFloat($('#f-stopbits').value) || 1,
    flow: $('#f-flow').value,
    lineEnding: $('#f-lineending').value,
    localEcho: $('#f-localecho').checked
  };
}

function saveHostFromForm() {
  const host = collectForm();
  if (!host) return null;
  if (!host.name) host.name = host.type === 'ssh' ? `${host.username}@${host.host}` : host.path;
  const idx = state.hosts.findIndex(x => x.id === host.id);
  if (idx >= 0) state.hosts[idx] = host;
  else state.hosts.push(host);
  persistHosts();
  return host;
}

/* ---------------- Settings → terminals ---------------- */

function applySettingsToPanes() {
  const opts = terminalOptions();
  for (const pane of allPanes()) {
    Object.assign(pane.term.options, opts);
    pane.holder.style.background = opts.theme.background;
    scheduleFit(pane);
  }
  emit('coo:settings');
}

/* ---------------- Side panel (Files / Snippets) ---------------- */

let sideOpen = null; // 'sftp' | 'snippets' | null

function setSide(name) {
  sideOpen = name;
  $('#sidepanel').classList.toggle('hidden', !name);
  for (const which of ['sftp', 'snippets']) {
    $('#side-' + which).classList.toggle('hidden', which !== name);
    $('#tb-' + which).classList.toggle('active', which === name);
  }
  document.querySelectorAll('.side-tab').forEach(b => b.classList.toggle('active', b.dataset.side === name));
  emit('coo:side');
}

const toggleSide = name => setSide(sideOpen === name ? null : name);

/* ---------------- Wiring ---------------- */

paintIcons();

$('#btn-new-host').addEventListener('click', () => openModal(null));
$('#btn-refresh-ports').addEventListener('click', refreshPorts);
$('#search').addEventListener('input', renderHosts);

document.querySelectorAll('.seg-btn[data-type]').forEach(b =>
  b.addEventListener('click', () => setModalType(b.dataset.type)));
document.querySelectorAll('.seg-btn[data-auth]').forEach(b =>
  b.addEventListener('click', () => setModalAuth(b.dataset.auth)));

$('#btn-browse-key').addEventListener('click', async () => {
  const file = await window.api.pickFile();
  if (file) $('#f-keypath').value = file;
});
$('#btn-add-forward').addEventListener('click', () => addForwardRow().querySelector('.fwd-src').focus());

$('#btn-modal-cancel').addEventListener('click', closeModal);
$('#btn-modal-save').addEventListener('click', () => {
  if (saveHostFromForm()) closeModal();
});
$('#btn-modal-connect').addEventListener('click', () => {
  const host = saveHostFromForm();
  if (host) { closeModal(); connect(host); }
});

$('#modal-backdrop').addEventListener('mousedown', ev => {
  if (ev.target === ev.currentTarget) closeModal();
});

/* Toolbar */

const belowButton = btn => {
  const r = btn.getBoundingClientRect();
  return [r.left, r.bottom + 4];
};
$('#tb-split-right').addEventListener('click', ev => openSplitMenu('right', ...belowButton(ev.currentTarget)));
$('#tb-split-down').addEventListener('click', ev => openSplitMenu('down', ...belowButton(ev.currentTarget)));
$('#tb-sftp').addEventListener('click', () => toggleSide('sftp'));
$('#tb-snippets').addEventListener('click', () => toggleSide('snippets'));
$('#tb-log').addEventListener('click', () => toggleLog(activePane()));
$('#tb-settings').addEventListener('click', openSettings);
$('#side-close').addEventListener('click', () => setSide(null));
document.querySelectorAll('.side-tab').forEach(b => b.addEventListener('click', () => setSide(b.dataset.side)));

/* Connection popup buttons */

$('#btn-connect-cancel').addEventListener('click', () => {
  const a = currentAttempt;
  if (a && !a.failed) {
    a.cancelled = true;
    window.api.cancelConnect(a.connectId);
    closeConnectPopup();
    // A first attempt leaves nothing worth keeping; a reconnect keeps the pane and its history
    if (!a.reconnect) closePane(a.pane);
  } else {
    closeConnectPopup(); // failed state: keep the pane with its error text
  }
});

$('#btn-connect-retry').addEventListener('click', () => {
  const a = currentAttempt;
  if (!a) return;
  currentAttempt = null;
  attemptConnection(a.pane, { reconnect: a.reconnect });
});

const verboseBox = $('#connect-verbose');
verboseBox.checked = localStorage.getItem('verboseLog') === '1';
$('#connect-log').classList.toggle('hidden', !verboseBox.checked);
verboseBox.addEventListener('change', () => {
  localStorage.setItem('verboseLog', verboseBox.checked ? '1' : '0');
  $('#connect-log').classList.toggle('hidden', !verboseBox.checked);
});

/* Keyboard. Capture phase, so shortcuts win over the terminal — which otherwise
   swallows every key it can send to the remote side. */

const isOpen = sel => !$(sel).classList.contains('hidden');

function handleEscape() {
  if (openMenuEl) { closeMenu(); return true; }
  if (openDialogClose) { openDialogClose(); return true; }
  if (isOpen('#connect-backdrop')) { $('#btn-connect-cancel').click(); return true; }
  if (isOpen('#preview')) {
    if (preview.find.open) closePreviewFind(); else closePreview(); // Esc backs out one step at a time
    return true;
  }
  if (isOpen('#settings-backdrop')) { closeSettings(); return true; }
  if (isOpen('#snip-backdrop')) { $('#snip-cancel').click(); return true; }
  if (isOpen('#modal-backdrop')) { closeModal(); return true; }
  return false;
}

document.addEventListener('keydown', ev => {
  const stop = () => { ev.preventDefault(); ev.stopPropagation(); };

  if (ev.key === 'Escape') {
    if (handleEscape()) stop();
    return; // otherwise Escape belongs to the terminal (or the find bar's own handler)
  }
  if (document.querySelector('.backdrop:not(.hidden)')) return; // a dialog is open: no app shortcuts

  const inTerminal = !!(ev.target.closest && ev.target.closest('.pane'));
  const pane = activePane();

  // While a file preview is up, Ctrl+F searches that file
  if (ev.ctrlKey && !ev.altKey && ev.code === 'KeyF' && isOpen('#preview') && !inTerminal) { stop(); openPreviewFind(); return; }

  if (ev.ctrlKey && ev.shiftKey && !ev.altKey) {
    switch (ev.code) {
      case 'KeyC': if (inTerminal && pane) { stop(); copySelection(pane); } return;
      case 'KeyV': if (inTerminal && pane) { stop(); pasteInto(pane); } return;
      case 'KeyF': stop(); emit('coo:find'); return;
      case 'KeyW': if (pane) { stop(); closePane(pane); } return;
      case 'KeyD': stop(); splitActive('right'); return;
      case 'KeyE': stop(); splitActive('down'); return;
      case 'Tab': stop(); stepTab(-1); return;
    }
  }
  if (ev.ctrlKey && !ev.altKey) {
    if (ev.code === 'Tab' && !ev.shiftKey) { stop(); stepTab(1); return; }
    if (ev.key === '=' || ev.key === '+') { stop(); changeFontSize(1); return; }
    if (ev.key === '-' && !ev.shiftKey) { stop(); changeFontSize(-1); return; }
    if (ev.key === '0' && !ev.shiftKey) { stop(); changeFontSize(0); return; }
    // Ctrl+W closes the tab only when the terminal isn't focused (there it means "delete word")
    if (ev.code === 'KeyW' && !ev.shiftKey && !inTerminal) {
      const tab = activeTab();
      if (tab) { stop(); closeTab(tab); }
    }
  }
}, true);

/* ---------------- Network config panel ---------------- */

const net = {
  interfaces: [],
  presets: [],
  ipMode: 'dhcp',
  macMode: 'keep'
};

function randomMac() {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  bytes[0] = (bytes[0] & 0xfc) | 0x02; // locally-administered, unicast
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function prefixToMaskJs(prefix) {
  const p = parseInt(prefix, 10);
  if (!(p >= 0 && p <= 32)) return null;
  const o = [0, 0, 0, 0];
  for (let i = 0; i < p; i++) o[i >> 3] |= 1 << (7 - (i % 8));
  return o.join('.');
}

function selectedInterface() {
  return net.interfaces.find(i => i.name === $('#net-if').value) || null;
}

function renderCurrentInterface() {
  const el = $('#net-current');
  const iface = selectedInterface();
  if (!iface) { el.innerHTML = ''; return; }
  const rows = [
    ['Status', iface.status],
    ['IP', iface.ip ? `${iface.ip}/${iface.prefix} ${iface.dhcp ? '(DHCP)' : '(static)'}` : '—'],
    ['Gateway', iface.gateway || '—'],
    ['DNS', (iface.dns && iface.dns.length) ? iface.dns.join(', ') : '—'],
    ['MAC', iface.mac || '—'],
    ['Permanent', iface.permanentMac || '—']
  ];
  el.innerHTML = rows
    .map(([k, v]) => `<div><span class="k">${k}:</span> <span class="v">${v}</span></div>`)
    .join('');
}

async function loadInterfaces(selectName) {
  const sel = $('#net-if');
  sel.innerHTML = '<option>Loading…</option>';
  const res = await window.api.netList();
  if (!res.ok) {
    sel.innerHTML = '<option>Error</option>';
    netLog([{ level: 'error', message: res.error }]);
    return;
  }
  net.interfaces = res.interfaces;
  sel.innerHTML = '';
  for (const iface of net.interfaces) {
    const opt = document.createElement('option');
    opt.value = iface.name;
    opt.textContent = `${iface.name}${iface.status ? ` (${iface.status})` : ''}`;
    sel.appendChild(opt);
  }
  if (selectName && net.interfaces.some(i => i.name === selectName)) sel.value = selectName;
  renderCurrentInterface();
}

function setNetIpMode(mode) {
  net.ipMode = mode;
  document.querySelectorAll('#net-ipmode .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  $('#net-static').classList.toggle('hidden', mode !== 'static');
}

function updateMaskHint() {
  const mask = prefixToMaskJs($('#net-prefix').value);
  $('#net-mask-hint').textContent = mask ? `Subnet mask: ${mask}` : 'Invalid prefix';
}

function setNetMacMode(mode) {
  net.macMode = mode;
  document.querySelectorAll('#net-macmode .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));

  const wrap = $('#net-mac-wrap');
  const input = $('#net-mac');
  const regen = $('#net-mac-regen');
  const note = $('#net-mac-note');

  wrap.classList.toggle('hidden', mode !== 'custom' && mode !== 'random');
  regen.classList.toggle('hidden', mode !== 'random');
  input.readOnly = mode === 'random';

  note.classList.add('hidden');
  if (mode === 'random') {
    input.value = randomMac();
  } else if (mode === 'restore') {
    const iface = selectedInterface();
    note.textContent = iface && iface.permanentMac
      ? `Will restore permanent MAC: ${iface.permanentMac}`
      : 'Will restore the adapter’s permanent MAC.';
    note.classList.remove('hidden');
  } else if (mode === 'custom' && !input.value) {
    const iface = selectedInterface();
    if (iface && iface.mac) input.value = iface.mac;
  }
}

function netLog(lines, clear = true) {
  const log = $('#net-log');
  if (clear) log.innerHTML = '';
  log.classList.remove('hidden');
  for (const { level, message } of lines) {
    const line = document.createElement('div');
    line.className = 'log-line ' + (level || 'info');
    line.textContent = message;
    log.appendChild(line);
  }
  log.scrollTop = log.scrollHeight;
}

function collectNetForm() {
  const iface = selectedInterface();
  return {
    ifName: iface ? iface.name : '',
    ipMode: net.ipMode,
    ip: $('#net-ip').value.trim(),
    prefix: $('#net-prefix').value.trim(),
    gateway: $('#net-gw').value.trim(),
    dns: $('#net-dns').value.trim(),
    macMode: net.macMode,
    mac: $('#net-mac').value.trim()
  };
}

async function applyNet() {
  const cfg = collectNetForm();
  if (!cfg.ifName) { netLog([{ level: 'error', message: 'Select an interface first.' }]); return; }

  const btn = $('#net-apply');
  btn.disabled = true;
  btn.textContent = 'Applying… (approve UAC)';
  netLog([{ level: 'info', message: 'Requesting elevation…' }]);

  const res = await window.api.netApply(cfg);

  const lines = (res.log || []).map(m => ({ level: /error|fail/i.test(m) ? 'error' : 'info', message: m }));
  if (res.ok) lines.push({ level: 'info', message: '✓ Changes applied successfully.' });
  else lines.push({ level: 'error', message: `✗ ${res.error || 'Failed.'}` });
  netLog(lines);

  btn.disabled = false;
  btn.textContent = 'Apply Changes';
  if (res.ok) setTimeout(() => loadInterfaces(cfg.ifName), 1500);
}

/* Presets */

function presetSubtitle(p) {
  const ipPart = p.ipMode === 'dhcp' ? 'DHCP' : `${p.ip || '?'}/${p.prefix || '?'}`;
  const macPart = { keep: '', custom: ` · MAC ${p.mac}`, random: ' · MAC random', restore: ' · MAC restore' }[p.macMode] || '';
  return `${p.ifName || 'any'} · ${ipPart}${macPart}`;
}

async function loadNetPresets() {
  net.presets = await window.api.netLoadPresets();
  renderNetPresets();
}

function renderNetPresets() {
  const list = $('#net-presets');
  list.innerHTML = '';
  if (!net.presets.length) {
    list.innerHTML = '<div class="empty-note">No presets saved</div>';
    return;
  }
  for (const p of net.presets) {
    const item = document.createElement('div');
    item.className = 'preset-item';

    const meta = document.createElement('div');
    meta.className = 'preset-meta';
    const name = document.createElement('div');
    name.className = 'preset-name';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'preset-sub';
    sub.textContent = presetSubtitle(p);
    meta.append(name, sub);

    const del = document.createElement('button');
    del.className = 'preset-del';
    del.textContent = '✕';
    del.title = 'Delete preset';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      net.presets = net.presets.filter(x => x.id !== p.id);
      window.api.netSavePresets(net.presets);
      renderNetPresets();
    });

    item.append(meta, del);
    item.addEventListener('click', () => applyPresetToForm(p));
    list.appendChild(item);
  }
}

function applyPresetToForm(p) {
  if (p.ifName && net.interfaces.some(i => i.name === p.ifName)) $('#net-if').value = p.ifName;
  renderCurrentInterface();
  setNetIpMode(p.ipMode || 'dhcp');
  $('#net-ip').value = p.ip || '';
  $('#net-prefix').value = p.prefix || 24;
  $('#net-gw').value = p.gateway || '';
  $('#net-dns').value = p.dns || '';
  updateMaskHint();
  setNetMacMode(p.macMode || 'keep');
  if (p.macMode === 'custom') $('#net-mac').value = p.mac || '';
}

async function saveNetPreset() {
  const name = await askText({ title: 'Save preset', label: 'Preset name', okLabel: 'Save' });
  if (!name) return;
  const cfg = collectNetForm();
  net.presets.push({ id: 'p' + Date.now(), name, ...cfg });
  window.api.netSavePresets(net.presets);
  renderNetPresets();
}

/* Wiring */

function toggleNetPanel(open) {
  const panel = $('#net-panel');
  const show = open === undefined ? !panel.classList.contains('open') : open;
  panel.classList.toggle('open', show);
  $('#tb-net').classList.toggle('active', show);
  if (show && !net.interfaces.length) loadInterfaces();
}

$('#tb-net').addEventListener('click', () => toggleNetPanel());
$('#net-close').addEventListener('click', () => toggleNetPanel(false));
$('#net-refresh').addEventListener('click', () => loadInterfaces($('#net-if').value));
$('#net-if').addEventListener('change', () => { renderCurrentInterface(); if (net.macMode === 'restore') setNetMacMode('restore'); });
$('#net-prefix').addEventListener('input', updateMaskHint);
$('#net-mac-regen').addEventListener('click', () => { $('#net-mac').value = randomMac(); });
$('#net-apply').addEventListener('click', applyNet);
$('#net-save-preset').addEventListener('click', saveNetPreset);

document.querySelectorAll('#net-ipmode .seg-btn').forEach(b =>
  b.addEventListener('click', () => setNetIpMode(b.dataset.mode)));
document.querySelectorAll('#net-macmode .seg-btn').forEach(b =>
  b.addEventListener('click', () => setNetMacMode(b.dataset.mode)));

updateMaskHint();
updateChrome();
renderLocalShells();
loadHosts();

// Startup speed: port detection loads the serial driver in the main process and
// presets live in a closed panel, so do both after the first frame is painted.
requestAnimationFrame(() => setTimeout(() => {
  refreshPorts();
  loadNetPresets();
}, 0));
