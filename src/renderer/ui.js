/* Small shared UI helpers: DOM shortcuts, icons, toasts, popup menus, dialogs. */

const $ = sel => document.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICON_PATHS = {
  splitRight: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/>',
  splitDown: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 8h12"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/>',
  folder: '<path d="M2 4.5h4l1.4 1.5H14v6.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  snippet: '<path d="M6 4 2.5 8 6 12M10 4l3.5 4L10 12"/>',
  record: '<circle cx="8" cy="8" r="5.2"/><circle class="fill" cx="8" cy="8" r="2.4"/>',
  net: '<circle cx="8" cy="8" r="5.8"/><path d="M2.2 8h11.6M8 2.2c2 1.6 2 10 0 11.6M8 2.2c-2 1.6-2 10 0 11.6"/>',
  settings: '<path d="M2 5h6M12 5h2M2 11h2M8 11h6"/><circle cx="10" cy="5" r="1.8"/><circle cx="6" cy="11" r="1.8"/>',
  more: '<circle class="dot" cx="3.5" cy="8" r="1.1"/><circle class="dot" cx="8" cy="8" r="1.1"/><circle class="dot" cx="12.5" cy="8" r="1.1"/>',
  share: '<path d="M8 10V2.5M5.2 5 8 2.2 10.8 5M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4"/>',
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 13h10"/>',
  newFolder: '<path d="M2 4.5h4l1.4 1.5H14v6.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M8 8v3.4M6.3 9.7h3.4"/>'
};

function iconSvg(name) {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = iconSvg(node.dataset.icon); });
}

/* ---------------- Toasts ---------------- */

function toast(message, kind = 'info') {
  const node = el('div', 'toast ' + kind, message);
  $('#toasts').appendChild(node);
  setTimeout(() => node.classList.add('out'), kind === 'error' ? 6000 : 3500);
  setTimeout(() => node.remove(), kind === 'error' ? 6400 : 3900);
}

/* ---------------- Popup menu ---------------- */

let openMenuEl = null;

function closeMenu() {
  if (openMenuEl) {
    openMenuEl.remove();
    openMenuEl = null;
  }
}

// items: { label, action, disabled, danger } | { header } | 'sep'
function showMenu(x, y, items) {
  closeMenu();
  const menu = el('div', 'menu');
  for (const item of items) {
    if (item === 'sep') { menu.appendChild(el('div', 'menu-sep')); continue; }
    if (item.header) { menu.appendChild(el('div', 'menu-header', item.header)); continue; }
    const row = el('button', 'menu-item' + (item.danger ? ' danger' : ''), item.label);
    row.type = 'button';
    row.disabled = !!item.disabled;
    row.addEventListener('click', () => { closeMenu(); item.action(); });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
  openMenuEl = menu;
}

document.addEventListener('mousedown', ev => {
  if (openMenuEl && !openMenuEl.contains(ev.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/* ---------------- Dialogs (replace prompt()/confirm(), which Electron handles badly) ---------------- */

let openDialogClose = null;

function dialog({ title, message, label, value, placeholder, okLabel = 'OK', danger = false, input = false }) {
  return new Promise(resolve => {
    const backdrop = el('div', 'backdrop ask-backdrop');
    const box = el('div', 'dialog ask-dialog');
    box.appendChild(el('div', 'modal-title', title));
    if (message) box.appendChild(el('div', 'ask-message', message));

    let field = null;
    if (input) {
      const row = el('div', 'form-row');
      if (label) row.appendChild(el('label', '', label));
      field = el('input');
      field.type = 'text';
      field.value = value || '';
      field.placeholder = placeholder || '';
      field.spellcheck = false;
      row.appendChild(field);
      box.appendChild(row);
    }

    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn', 'Cancel');
    const ok = el('button', 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), okLabel);
    cancel.type = ok.type = 'button';
    actions.append(cancel, ok);
    box.appendChild(actions);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    const finish = result => {
      backdrop.remove();
      openDialogClose = null;
      resolve(result);
    };
    const accept = () => {
      if (!input) return finish(true);
      const text = field.value.trim();
      if (!text) { field.focus(); return; }
      finish(text);
    };
    openDialogClose = () => finish(input ? null : false);

    cancel.addEventListener('click', openDialogClose);
    ok.addEventListener('click', accept);
    backdrop.addEventListener('mousedown', ev => { if (ev.target === backdrop) openDialogClose(); });
    box.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });

    if (field) { field.focus(); field.select(); } else ok.focus();
  });
}

const askText = opts => dialog({ ...opts, input: true });
const askConfirm = opts => dialog({ okLabel: 'Delete', danger: true, ...opts, input: false });

/* ---------------- Formatting ---------------- */

function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
}

function formatDate(epochSeconds) {
  if (!epochSeconds) return '';
  const d = new Date(epochSeconds * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
