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

function runSnippet(s) {
  const pane = activePane();
  if (!pane) { toast('Open a terminal first.', 'error'); return; }
  if (pane.status !== 'connected') { toast('That terminal is not connected.', 'error'); return; }
  sendText(pane, s.command + (s.run ? '\n' : ''));
  pane.term.focus();
}

function renderSnippets() {
  const list = $('#snip-list');
  const filter = $('#snip-search').value.trim().toLowerCase();
  list.innerHTML = '';
  const shown = snip.items.filter(s =>
    !filter || s.name.toLowerCase().includes(filter) || s.command.toLowerCase().includes(filter));

  if (!shown.length) {
    list.appendChild(el('div', 'empty-note', snip.items.length ? 'No snippets match' : 'No snippets yet — add commands you type often.'));
    return;
  }

  for (const s of shown) {
    const item = el('div', 'snip-item');
    item.title = s.command;

    const meta = el('div', 'snip-meta');
    const name = el('div', 'snip-name', s.name);
    if (s.run) name.appendChild(el('span', 'snip-badge', '↵'));
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
    list.appendChild(item);
  }
}

function openSnippetEditor(s) {
  snip.editingId = s ? s.id : null;
  $('#snip-title').textContent = s ? 'Edit snippet' : 'New snippet';
  $('#snip-name').value = s ? s.name : '';
  $('#snip-cmd').value = s ? s.command : '';
  $('#snip-run').checked = s ? !!s.run : true;
  $('#snip-backdrop').classList.remove('hidden');
  $('#snip-name').focus();
}

function closeSnippetEditor() {
  $('#snip-backdrop').classList.add('hidden');
}

function saveSnippet() {
  const command = $('#snip-cmd').value.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!command.trim()) { $('#snip-cmd').focus(); return; }
  const name = $('#snip-name').value.trim() || command.split('\n')[0].slice(0, 40);
  const entry = { id: snip.editingId || 'sn' + Date.now(), name, command, run: $('#snip-run').checked };
  const idx = snip.items.findIndex(x => x.id === entry.id);
  if (idx >= 0) snip.items[idx] = entry;
  else snip.items.push(entry);
  persistSnippets();
  closeSnippetEditor();
}

$('#snip-new').addEventListener('click', () => openSnippetEditor(null));
$('#snip-search').addEventListener('input', renderSnippets);
$('#snip-cancel').addEventListener('click', closeSnippetEditor);
$('#snip-save').addEventListener('click', saveSnippet);
$('#snip-backdrop').addEventListener('mousedown', ev => { if (ev.target === ev.currentTarget) closeSnippetEditor(); });
$('#snip-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#snip-cmd').focus(); } });
$('#snip-cmd').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); saveSnippet(); } });

// Loaded the first time the panel is shown, so it costs nothing at startup
document.addEventListener('coo:side', () => {
  if (sideOpen === 'snippets' && !snip.loaded) loadSnippets();
});
