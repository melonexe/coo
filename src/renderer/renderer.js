/* global Terminal, FitAddon, WebLinksAddon */

const state = {
  hosts: [],
  tabs: [],            // { id, sessionId, cfg, term, fit, holder, tabEl, dotEl, status }
  activeTabId: null,
  nextTabId: 1,
  editingHostId: null,
  modalType: 'ssh',
  modalAuth: 'password'
};

const bySession = new Map();   // sessionId -> tab
const pendingData = new Map(); // sessionId -> [chunks] arriving before tab is mapped

const $ = sel => document.querySelector(sel);

const TERM_THEME = {
  background: '#14161b',
  foreground: '#d5dae4',
  cursor: '#4d9fff',
  cursorAccent: '#14161b',
  selectionBackground: '#2f4a7d',
  black: '#21252e', red: '#e5534b', green: '#3fb950', yellow: '#d4a72c',
  blue: '#3d7eff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#d5dae4',
  brightBlack: '#5a6374', brightRed: '#ff7b72', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79b8ff', brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#ffffff'
};

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
    delBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm(`Delete host "${h.name || hostSubtitle(h)}"?`)) return;
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

async function refreshPorts() {
  const list = $('#ports-list');
  const ports = await window.api.listPorts();
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
    item.addEventListener('click', () =>
      connect({ type: 'serial', name: p.path, path: p.path, baudRate: 115200 })
    );
    list.appendChild(item);
  }
}

/* ---------------- Tabs & terminals ---------------- */

function setTabStatus(tab, status) {
  tab.status = status;
  tab.dotEl.className = 'tab-dot ' + status;
}

function activateTab(tabId) {
  state.activeTabId = tabId;
  for (const t of state.tabs) {
    const active = t.id === tabId;
    t.tabEl.classList.toggle('active', active);
    t.holder.classList.toggle('active', active);
    if (active) {
      requestAnimationFrame(() => {
        t.fit.fit();
        if (t.sessionId) window.api.resize(t.sessionId, t.term.cols, t.term.rows);
        t.term.focus();
      });
    }
  }
  $('#welcome').style.display = state.tabs.length ? 'none' : 'flex';
}

async function closeTab(tab) {
  if (tab.sessionId) {
    bySession.delete(tab.sessionId);
    await window.api.closeSession(tab.sessionId);
  }
  tab.term.dispose();
  tab.holder.remove();
  tab.tabEl.remove();
  state.tabs = state.tabs.filter(t => t !== tab);
  if (state.activeTabId === tab.id) {
    const next = state.tabs[state.tabs.length - 1];
    activateTab(next ? next.id : null);
  } else if (!state.tabs.length) {
    activateTab(null);
  }
}

function createTab(cfg) {
  const id = state.nextTabId++;

  const holder = document.createElement('div');
  holder.className = 'term-holder';
  $('#terminals').appendChild(holder);

  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 14,
    cursorBlink: true,
    scrollback: 8000,
    allowProposedApi: true,
    theme: TERM_THEME
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon.WebLinksAddon());
  term.open(holder);

  // Ctrl+Shift+C / Ctrl+Shift+V for copy/paste
  term.attachCustomKeyEventHandler(ev => {
    if (ev.type !== 'keydown' || !ev.ctrlKey || !ev.shiftKey) return true;
    if (ev.code === 'KeyC' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      return false;
    }
    if (ev.code === 'KeyV') {
      navigator.clipboard.readText().then(text => sendInput(tab, text));
      return false;
    }
    return true;
  });

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  const dotEl = document.createElement('div');
  dotEl.className = 'tab-dot connecting';
  const titleEl = document.createElement('div');
  titleEl.className = 'tab-title';
  titleEl.textContent = cfg.name || (cfg.type === 'serial' ? cfg.path : cfg.host);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close';
  closeBtn.textContent = '✕';
  tabEl.append(dotEl, titleEl, closeBtn);
  $('#tabbar').appendChild(tabEl);

  const tab = { id, sessionId: null, cfg, term, fit, holder, tabEl, dotEl, status: 'connecting' };

  tabEl.addEventListener('click', () => activateTab(id));
  tabEl.addEventListener('auxclick', ev => { if (ev.button === 1) closeTab(tab); });
  closeBtn.addEventListener('click', ev => { ev.stopPropagation(); closeTab(tab); });

  term.onData(data => sendInput(tab, data));

  new ResizeObserver(() => {
    if (holder.classList.contains('active')) {
      fit.fit();
      if (tab.sessionId) window.api.resize(tab.sessionId, term.cols, term.rows);
    }
  }).observe(holder);

  state.tabs.push(tab);
  activateTab(id);
  return tab;
}

function sendInput(tab, data) {
  if (!tab.sessionId || tab.status !== 'connected') return;

  if (tab.cfg.type === 'serial') {
    // Map Enter to the configured line ending
    const le = { cr: '\r', lf: '\n', crlf: '\r\n' }[tab.cfg.lineEnding || 'cr'];
    const out = data.replace(/\r/g, le);
    window.api.input(tab.sessionId, out);
    if (tab.cfg.localEcho) {
      tab.term.write(data.replace(/\r/g, '\r\n').replace(/\x7f/g, '\b \b'));
    }
  } else {
    window.api.input(tab.sessionId, data);
  }
}

/* ---------------- Connection popup ---------------- */

let currentAttempt = null; // { connectId, tab, cancelled, failed }
let nextConnectId = 1;

function connectTarget(cfg) {
  if (cfg.type === 'serial') return `${cfg.path} @ ${cfg.baudRate || 115200}`;
  if (cfg.type === 'local') return cfg.shell || 'powershell.exe';
  return `${cfg.username || '?'}@${cfg.host}:${cfg.port || 22}`;
}

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
  $('#connect-backdrop').classList.add('hidden');
  currentAttempt = null;
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

async function connect(cfg) {
  const tab = createTab(cfg);
  attemptConnection(tab);
}

async function attemptConnection(tab) {
  const cfg = tab.cfg;
  const connectId = 'c' + nextConnectId++;
  const attempt = { connectId, tab, cancelled: false, failed: false };
  const showProgress = cfg.type !== 'local'; // local shells spawn instantly

  if (showProgress) {
    currentAttempt = attempt;
    openConnectPopup(cfg);
    tab.term.write(`\x1b[90mConnecting to ${connectTarget(cfg)}...\x1b[0m\r\n`);
  }
  setTabStatus(tab, 'connecting');

  const res = await window.api.createSession({
    ...cfg,
    connectId,
    cols: tab.term.cols,
    rows: tab.term.rows
  });

  if (attempt.cancelled) {
    // User cancelled while the attempt was in flight; clean up if it won anyway
    if (res.ok) window.api.closeSession(res.id);
    return;
  }

  if (!res.ok) {
    attempt.failed = true;
    setTabStatus(tab, 'closed');
    tab.term.write(`\x1b[91mConnection failed: ${res.error}\x1b[0m\r\n`);
    if (currentAttempt === attempt) connectPopupFailed(res.error);
    return;
  }

  tab.sessionId = res.id;
  bySession.set(res.id, tab);
  setTabStatus(tab, 'connected');
  if (showProgress) tab.term.write('\x1b[2K\x1b[1A\x1b[2K\r'); // clear the "Connecting..." line

  const backlog = pendingData.get(res.id);
  if (backlog) {
    for (const chunk of backlog) tab.term.write(chunk);
    pendingData.delete(res.id);
  }
  window.api.resize(res.id, tab.term.cols, tab.term.rows);
  if (currentAttempt === attempt) closeConnectPopup();
  tab.term.focus();
}

window.api.onData(({ id, data }) => {
  const tab = bySession.get(id);
  if (tab) {
    tab.term.write(new Uint8Array(data));
  } else {
    if (!pendingData.has(id)) pendingData.set(id, []);
    pendingData.get(id).push(new Uint8Array(data));
  }
});

window.api.onStatus(({ id, status, message }) => {
  const tab = bySession.get(id);
  if (!tab) return;
  if (status === 'closed') {
    setTabStatus(tab, 'closed');
    tab.term.write('\r\n\x1b[90m[Session closed]\x1b[0m\r\n');
  } else if (status === 'error') {
    tab.term.write(`\r\n\x1b[91m[Error: ${message}]\x1b[0m\r\n`);
  }
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
    return {
      ...base,
      host,
      port: parseInt($('#f-port').value, 10) || 22,
      username: $('#f-username').value.trim(),
      auth: state.modalAuth,
      password: $('#f-password').value,
      keyPath: $('#f-keypath').value.trim(),
      passphrase: $('#f-passphrase').value
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

/* ---------------- Wiring ---------------- */

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

/* Connection popup buttons */

$('#btn-connect-cancel').addEventListener('click', () => {
  const a = currentAttempt;
  if (a && !a.failed) {
    a.cancelled = true;
    window.api.cancelConnect(a.connectId);
    const tab = a.tab;
    closeConnectPopup();
    closeTab(tab); // nothing useful in a never-connected tab
  } else {
    closeConnectPopup(); // failed state: keep the tab with its error text
  }
});

$('#btn-connect-retry').addEventListener('click', () => {
  const a = currentAttempt;
  if (!a) return;
  const tab = a.tab;
  currentAttempt = null;
  attemptConnection(tab);
});

const verboseBox = $('#connect-verbose');
verboseBox.checked = localStorage.getItem('verboseLog') === '1';
$('#connect-log').classList.toggle('hidden', !verboseBox.checked);
verboseBox.addEventListener('change', () => {
  localStorage.setItem('verboseLog', verboseBox.checked ? '1' : '0');
  $('#connect-log').classList.toggle('hidden', !verboseBox.checked);
});

document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && !$('#connect-backdrop').classList.contains('hidden')) {
    $('#btn-connect-cancel').click();
    return;
  }
  if (ev.key === 'Escape' && !$('#modal-backdrop').classList.contains('hidden')) closeModal();
  // Ctrl+W closes the active tab
  if (ev.ctrlKey && !ev.shiftKey && ev.code === 'KeyW') {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (tab) { ev.preventDefault(); closeTab(tab); }
  }
});

window.addEventListener('resize', () => {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (tab) {
    tab.fit.fit();
    if (tab.sessionId) window.api.resize(tab.sessionId, tab.term.cols, tab.term.rows);
  }
});

loadHosts();
renderLocalShells();
refreshPorts();
