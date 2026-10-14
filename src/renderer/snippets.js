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

const runs = new Map(); // pane -> { snippet, stop(), until, timer }

function runSnippet(s) {
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

  const steps = snippetSteps(s);
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

  const running = new Set([...runs.values()].map(r => r.snippet.id));
  for (const s of shown) {
    const item = el('div', 'snip-item');
    item.dataset.id = s.id;
    item.title = s.command;
    if (running.has(s.id)) {
      item.classList.add('running');
      item.title += '\n\nRunning. Click to stop.';
    }

    const meta = el('div', 'snip-meta');
    const name = el('div', 'snip-name', s.name);
    if (s.run) name.appendChild(el('span', 'snip-badge', '↵'));
    if (hasSleeps(s)) name.appendChild(el('span', 'snip-badge', '⏱'));
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

// Edited in another window
window.api.onSnippetsChanged(() => { if (snip.loaded) loadSnippets(); });
