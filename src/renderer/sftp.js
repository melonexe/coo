/* Files panel: SFTP browser for the focused SSH session. */

const sftp = {
  pane: null,        // the pane the panel is showing
  dir: '',
  entries: [],
  loading: false,
  selected: null,    // entry name
  nextXfer: 1,
  transfers: new Map() // xferId -> { label }
};

const sftpUsable = pane => !!(pane && pane.cfg.type === 'ssh' && pane.status === 'connected' && pane.sessionId);

function sftpMessage(text, kind = '') {
  const list = $('#sftp-list');
  list.innerHTML = '';
  list.appendChild(el('div', 'sftp-empty ' + kind, text));
}

function setSftpStatus(text, kind = '') {
  const node = $('#sftp-status');
  node.title = '';
  node.textContent = text || '';
  node.className = 'sftp-status ' + kind;
}

// Tell the user when the host has no SFTP and the panel is running on shell commands instead
function setSftpMode(res) {
  const node = $('#sftp-mode');
  const fallback = !!(res && res.mode === 'shell');
  node.classList.toggle('hidden', !fallback);
  if (fallback) {
    node.textContent = 'This host has no SFTP, so files are handled with shell commands and SCP (or cat where SCP is missing).';
    node.title = res.note ? `SFTP error: ${res.note}` : '';
  }
}

function setSftpEnabled(on) {
  for (const id of ['#sftp-up', '#sftp-path', '#sftp-refresh', '#sftp-mkdir', '#sftp-upload']) $(id).disabled = !on;
}

// Point the panel at the focused pane (called when focus, connection state or the panel changes)
function syncSftp() {
  if (sideOpen !== 'sftp') { closePreview(); return; }
  const pane = activePane();
  if (!sftpUsable(pane)) {
    sftp.pane = null;
    closePreview();
    setSftpEnabled(false);
    setSftpMode(null);
    $('#sftp-path').value = '';
    setSftpStatus('');
    sftpMessage(!pane ? 'Open an SSH session to browse its files.'
      : pane.cfg.type !== 'ssh' ? 'File transfer is available for SSH sessions.'
      : 'This session is not connected.');
    return;
  }
  setSftpEnabled(true);
  if (sftp.pane === pane && sftp.sessionId === pane.sessionId) return; // already showing it
  sftp.pane = pane;
  sftp.sessionId = pane.sessionId;
  listDir(pane.sftpDir || '.');
}

async function listDir(dir, { keepStatus = false } = {}) {
  const pane = sftp.pane;
  if (!sftpUsable(pane)) return;
  sftp.loading = true;
  if (!sftp.entries.length || pane.sftpDir == null) sftpMessage('Loading…');
  const res = await window.api.sftpList({ id: pane.sessionId, dir });
  if (sftp.pane !== pane) return; // focus moved on while we waited
  sftp.loading = false;
  if (!res.ok) {
    if (pane.sftpDir == null) setSftpMode(null);
    setSftpStatus(res.error, 'error');
    if (pane.sftpDir == null) sftpMessage(`Could not open the folder: ${res.error}`, 'error');
    $('#sftp-path').value = sftp.dir;
    return;
  }
  setSftpMode(res);
  sftp.dir = res.dir;
  pane.sftpDir = res.dir;
  closePreview();
  sftp.entries = res.entries;
  sftp.selected = null;
  $('#sftp-path').value = res.dir;
  if (!sftp.transfers.size && !keepStatus) setSftpStatus(`${res.entries.length} item${res.entries.length === 1 ? '' : 's'}`);
  renderSftp();
}

const refreshSftp = opts => listDir(sftp.dir || '.', opts);

function parentDir(dir) {
  if (dir === '/' || !dir) return '/';
  const cut = dir.replace(/\/+$/, '').lastIndexOf('/');
  return cut <= 0 ? '/' : dir.slice(0, cut);
}

const joinDir = (dir, name) => (dir.endsWith('/') ? dir : dir + '/') + name;

function renderSftp() {
  const list = $('#sftp-list');
  list.innerHTML = '';
  if (!sftp.entries.length) {
    list.appendChild(el('div', 'sftp-empty', 'This folder is empty. Drop files here to upload.'));
    return;
  }
  for (const entry of sftp.entries) {
    const row = el('div', 'sftp-row' + (entry.type === 'dir' ? ' dir' : ''));
    row.dataset.name = entry.name;
    const ico = el('span', 'sftp-ico');
    ico.innerHTML = iconSvg(entry.type === 'dir' ? 'folder' : 'file');
    const name = el('span', 'sftp-name', entry.name + (entry.link ? ' →' : ''));
    const size = el('span', 'sftp-size', entry.type === 'dir' ? '' : formatSize(entry.size));
    const details = [entry.type === 'dir' ? 'Folder' : formatSize(entry.size), entry.mtime ? `modified ${formatDate(entry.mtime)}` : ''].filter(Boolean).join(' · ');
    row.append(ico, name, size);
    row.title = `${entry.name}\n${details}`;

    row.addEventListener('click', () => { selectSftp(entry.name); $('#sftp-list').focus(); });
    row.addEventListener('dblclick', () => {
      if (entry.type === 'dir') listDir(joinDir(sftp.dir, entry.name));
      else downloadEntry(entry);
    });
    row.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      selectSftp(entry.name);
      const items = entry.type === 'dir'
        ? [{ label: 'Open', action: () => listDir(joinDir(sftp.dir, entry.name)) },
           { label: 'Download folder…', action: () => downloadFolder(entry) }]
        : [{ label: 'Download…', action: () => downloadEntry(entry) }];
      items.push(
        { label: 'Copy path', action: () => navigator.clipboard.writeText(joinDir(sftp.dir, entry.name)).catch(() => {}) },
        'sep',
        { label: 'Rename…', action: () => renameEntry(entry) },
        { label: 'Delete…', danger: true, action: () => deleteEntry(entry) }
      );
      showMenu(ev.clientX, ev.clientY, items);
    });
    list.appendChild(row);
  }
}

function selectSftp(name) {
  sftp.selected = name;
  document.querySelectorAll('#sftp-list .sftp-row').forEach(r => {
    const on = r.dataset.name === name;
    r.classList.toggle('selected', on);
    if (on) r.scrollIntoView({ block: 'nearest' });
  });
  if (preview.open) showPreview(); // the preview follows the selection
}

const selectedEntry = () => sftp.entries.find(e => e.name === sftp.selected) || null;

function moveSftpSelection(delta, absolute) {
  if (!sftp.entries.length) return;
  const at = sftp.entries.findIndex(e => e.name === sftp.selected);
  let next = absolute != null ? absolute : at === -1 ? (delta > 0 ? 0 : sftp.entries.length - 1) : at + delta;
  next = Math.max(0, Math.min(sftp.entries.length - 1, next));
  selectSftp(sftp.entries[next].name);
}

function openSftpEntry(entry) {
  if (!entry) return;
  if (entry.type === 'dir') listDir(joinDir(sftp.dir, entry.name));
  else downloadEntry(entry);
}

// Keyboard in the file list: arrows move, Space previews, Enter opens, Backspace goes up
$('#sftp-list').addEventListener('keydown', ev => {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  const rows = Math.max(1, Math.floor($('#sftp-list').clientHeight / 28) - 1);
  switch (ev.key) {
    case ' ': if (selectedEntry()) togglePreview(); break;
    case 'ArrowDown': moveSftpSelection(1); break;
    case 'ArrowUp': moveSftpSelection(-1); break;
    case 'PageDown': moveSftpSelection(rows); break;
    case 'PageUp': moveSftpSelection(-rows); break;
    case 'Home': moveSftpSelection(0, 0); break;
    case 'End': moveSftpSelection(0, sftp.entries.length - 1); break;
    case 'Enter': closePreview(); openSftpEntry(selectedEntry()); break;
    case 'Backspace': closePreview(); listDir(parentDir(sftp.dir)); break;
    default: return;
  }
  ev.preventDefault();
});


/* Operations — each re-checks the session, since it can drop at any time */

function sftpTarget() {
  const pane = sftp.pane;
  if (!sftpUsable(pane)) { toast('The SSH session is no longer connected.', 'error'); return null; }
  return { id: pane.sessionId, dir: sftp.dir };
}

function beginTransfer(label) {
  const xferId = 'x' + sftp.nextXfer++;
  sftp.transfers.set(xferId, { label });
  setSftpStatus(label + '…');
  return xferId;
}

function endTransfer(xferId, message, kind) {
  sftp.transfers.delete(xferId);
  setSftpStatus(message, kind);
}

const viaLabel = via => (via && via !== 'SFTP' ? ` (via ${via})` : '');

async function downloadEntry(entry) {
  const target = sftpTarget();
  if (!target) return;
  const xferId = beginTransfer(`Downloading ${entry.name}`);
  const res = await window.api.sftpDownload({ ...target, name: entry.name, size: entry.size, xferId });
  if (res.ok && res.cancelled) endTransfer(xferId, '');
  else if (res.ok) { endTransfer(xferId, `Downloaded to ${res.file}${viaLabel(res.via)}`); toast(`Downloaded ${entry.name}`); }
  else { endTransfer(xferId, `Download failed: ${res.error}`, 'error'); toast(`Download failed: ${res.error}`, 'error'); }
}

// Download a folder and everything under it (linked folders and device files are skipped)
async function downloadFolder(entry) {
  const target = sftpTarget();
  if (!target) return;
  const xferId = beginTransfer(`Downloading folder ${entry.name}`);
  sftp.folderXfer = xferId;
  const res = await window.api.sftpDownloadDir({ ...target, name: entry.name, xferId });
  sftp.folderXfer = null;
  $('#sftp-cancel').classList.add('hidden');

  if (res.ok && res.cancelled) { endTransfer(xferId, ''); return; }
  if (!res.ok) {
    endTransfer(xferId, `Folder download failed: ${res.error}`, 'error');
    toast(`Folder download failed: ${res.error}`, 'error');
    return;
  }
  const count = `${res.files} file${res.files === 1 ? '' : 's'} (${formatSize(res.bytes)})`;
  let msg = `${res.stopped ? 'Stopped after' : 'Downloaded'} ${count} to ${res.dest}${viaLabel(res.via)}`;
  const problems = [];
  if (res.failedCount) problems.push(`${res.failedCount} failed, e.g. ${res.failed[0].path}: ${res.failed[0].error}`);
  if (res.skippedCount) problems.push(`${res.skippedCount} skipped (linked folders or special files), e.g. ${res.skipped[0]}`);
  if (problems.length) msg += ` — ${problems.join('; ')}`;
  const bad = res.stopped || res.failedCount > 0;
  endTransfer(xferId, msg, bad ? 'error' : '');
  $('#sftp-status').title = msg;
  toast(msg, bad ? 'error' : 'info');
}

async function uploadFiles(files) {
  const target = sftpTarget();
  if (!target) return;
  const xferId = beginTransfer('Uploading');
  const res = await window.api.sftpUpload({ ...target, files, xferId });
  if (res.ok && res.cancelled) { endTransfer(xferId, ''); return; }
  if (!res.ok) {
    endTransfer(xferId, `Upload failed: ${res.error}`, 'error');
    toast(`Upload failed: ${res.error}`, 'error');
  } else {
    const n = res.uploaded.length;
    let msg = `Uploaded ${n} file${n === 1 ? '' : 's'}${n ? viaLabel(res.via) : ''}`;
    if (res.skipped.length) msg += ` — skipped ${res.skipped.join(', ')} (folders aren't supported)`;
    endTransfer(xferId, msg, res.skipped.length ? 'error' : '');
    toast(msg, res.skipped.length ? 'error' : 'info');
  }
  if (sftp.pane && sftp.dir === target.dir) refreshSftp({ keepStatus: true });
}

async function makeFolder() {
  const target = sftpTarget();
  if (!target) return;
  const name = await askText({ title: 'New folder', label: `Create in ${target.dir}`, placeholder: 'Folder name', okLabel: 'Create' });
  if (!name) return;
  if (name.includes('/')) { toast('A folder name cannot contain "/".', 'error'); return; }
  const res = await window.api.sftpMkdir({ ...target, name });
  if (!res.ok) toast(`Could not create the folder: ${res.error}`, 'error');
  refreshSftp();
}

async function renameEntry(entry) {
  const target = sftpTarget();
  if (!target) return;
  const to = await askText({ title: 'Rename', label: `New name for ${entry.name}`, value: entry.name, okLabel: 'Rename' });
  if (!to || to === entry.name) return;
  if (to.includes('/')) { toast('A name cannot contain "/".', 'error'); return; }
  const res = await window.api.sftpRename({ ...target, from: entry.name, to });
  if (!res.ok) toast(`Rename failed: ${res.error}`, 'error');
  refreshSftp();
}

async function deleteEntry(entry) {
  const target = sftpTarget();
  if (!target) return;
  const isDir = entry.type === 'dir' && !entry.link;
  const ok = await askConfirm({
    title: isDir ? 'Delete folder' : 'Delete file',
    message: `Permanently delete "${entry.name}" from the server?${isDir ? ' The folder must be empty.' : ''} This cannot be undone.`
  });
  if (!ok) return;
  const res = await window.api.sftpDelete({ ...target, name: entry.name, isDir });
  if (!res.ok) toast(`Delete failed: ${res.error}`, 'error');
  refreshSftp();
}

window.api.onSftpProgress(({ xferId, name, transferred, total, started, folder, files, bytes, current }) => {
  const t = sftp.transfers.get(xferId);
  if (!t) return;
  if (folder) {
    $('#sftp-cancel').classList.remove('hidden');
    setSftpStatus(`${t.label}… ${files} file${files === 1 ? '' : 's'}, ${formatSize(bytes)}${current ? ` — ${current}` : ''}`);
    return;
  }
  if (started && name) t.label = `${t.label.split(' ')[0]} ${name}`;
  const pct = total ? ` ${Math.floor((transferred / total) * 100)}%` : '';
  setSftpStatus(`${t.label}…${pct}${total ? ` (${formatSize(transferred)} of ${formatSize(total)})` : ''}`);
});

/* Wiring */

$('#sftp-up').addEventListener('click', () => listDir(parentDir(sftp.dir)));
$('#sftp-refresh').addEventListener('click', () => refreshSftp());
$('#sftp-mkdir').addEventListener('click', makeFolder);
$('#sftp-upload').addEventListener('click', () => uploadFiles(null));
$('#sftp-cancel').addEventListener('click', () => {
  if (sftp.folderXfer) window.api.sftpCancel(sftp.folderXfer);
  $('#sftp-cancel').classList.add('hidden');
});
$('#sftp-path').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { ev.preventDefault(); listDir(ev.target.value.trim() || '.'); }
  else if (ev.key === 'Escape') { ev.target.value = sftp.dir; ev.target.blur(); }
});

// Drag files from Explorer onto the list to upload them
const sftpDrop = $('#side-sftp');
sftpDrop.addEventListener('dragover', ev => {
  if (!sftp.pane || ![...ev.dataTransfer.types].includes('Files')) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
  sftpDrop.classList.add('dropping');
});
sftpDrop.addEventListener('dragleave', ev => { if (!sftpDrop.contains(ev.relatedTarget)) sftpDrop.classList.remove('dropping'); });
sftpDrop.addEventListener('drop', ev => {
  sftpDrop.classList.remove('dropping');
  if (!sftp.pane) return;
  ev.preventDefault();
  const paths = [...ev.dataTransfer.files].map(f => window.api.pathForFile(f)).filter(Boolean);
  if (paths.length) uploadFiles(paths);
});

document.addEventListener('coo:side', syncSftp);
document.addEventListener('coo:activepane', syncSftp);
document.addEventListener('coo:panestate', syncSftp);
