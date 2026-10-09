/* Sharing a setup with other people.
   - CSV: connections (SSH and serial) and snippets in one spreadsheet-friendly file.
   - .coosnip: a small JSON file holding one or more snippets.
   Passwords and key passphrases are never written to either. */

const CSV_COLUMNS = [
  'kind', 'name',
  'host', 'port', 'username', 'auth', 'key_path', 'forwards',
  'serial_port', 'baud_rate', 'data_bits', 'parity', 'stop_bits', 'flow_control', 'line_ending', 'local_echo',
  'command', 'press_enter'
];

/* ---------------- CSV ---------------- */

function csvField(value) {
  const s = value == null ? '' : String(value);
  return /[",;\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(c => csvField(row[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads it as UTF-8
}

// RFC 4180 parser: quoted fields, doubled quotes, line breaks inside quotes
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  // Excel in many locales saves with semicolons: go by whichever the header line uses more
  const header = src.slice(0, src.search(/\r|\n|$/));
  const delim = (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
      } else field += ch;
      i++;
    } else if (ch === '"' && field === '') { quoted = true; i++; }
    else if (ch === delim) { endField(); i++; }
    else if (ch === '\r') { endRow(); i += src[i + 1] === '\n' ? 2 : 1; }
    else if (ch === '\n') { endRow(); i++; }
    else { field += ch; i++; }
  }
  if (field !== '' || row.length) endRow();

  const filled = rows.filter(r => r.some(c => c.trim() !== ''));
  if (!filled.length) return [];
  const names = filled[0].map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return filled.slice(1).map(cells => {
    const obj = {};
    names.forEach((n, idx) => { obj[n] = cells[idx] != null ? cells[idx] : ''; });
    return obj;
  });
}

/* ---------------- Rows <-> hosts and snippets ---------------- */

// Port forwards as "L:8080:10.0.0.5:80; R:9000:localhost:22; D:1080"
function forwardsToText(forwards) {
  return (forwards || []).map(f =>
    f.type === 'dynamic' ? `D:${f.srcPort}` : `${f.type === 'remote' ? 'R' : 'L'}:${f.srcPort}:${f.dstHost}:${f.dstPort}`).join('; ');
}

function forwardsFromText(text) {
  const out = [];
  for (const part of String(text || '').split(/[;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const m = /^([LRD])\s*:\s*(\d+)(?:\s*:\s*(.+)\s*:\s*(\d+))?$/i.exec(part);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    const srcPort = +m[2];
    if (!(srcPort >= 1 && srcPort <= 65535)) continue;
    if (kind === 'D') out.push({ type: 'dynamic', srcPort });
    else if (m[3] && +m[4] >= 1 && +m[4] <= 65535) out.push({ type: kind === 'R' ? 'remote' : 'local', srcPort, dstHost: m[3].trim(), dstPort: +m[4] });
  }
  return out;
}

const yes = v => /^(y|yes|true|1|on)$/i.test(String(v || '').trim());

function hostToRow(h) {
  if (h.type === 'serial') {
    return {
      kind: 'serial', name: h.name || '', serial_port: h.path, baud_rate: h.baudRate || 115200, data_bits: h.dataBits || 8,
      parity: h.parity || 'none', stop_bits: h.stopBits || 1, flow_control: h.flow || 'none',
      line_ending: h.lineEnding || 'cr', local_echo: h.localEcho ? 'yes' : 'no'
    };
  }
  return {
    kind: 'ssh', name: h.name || '', host: h.host, port: h.port || 22, username: h.username || '',
    auth: h.auth === 'key' ? 'key' : 'password', key_path: h.auth === 'key' ? h.keyPath || '' : '',
    forwards: forwardsToText(h.forwards)
  };
}

const snippetToRow = s => ({ kind: 'snippet', name: s.name, command: s.command, press_enter: s.run ? 'yes' : 'no' });

const pick = (value, allowed, fallback) => {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
};

// Returns { host } | { snippet } | { error }
function rowToItem(row) {
  const kind = String(row.kind || '').trim().toLowerCase();
  const name = String(row.name || '').trim();
  if (kind === 'ssh') {
    const host = String(row.host || '').trim();
    if (!host) return { error: 'an SSH row has no host' };
    const username = String(row.username || '').trim();
    const port = parseInt(row.port, 10);
    return {
      host: {
        type: 'ssh', name: name || `${username}@${host}`, host, port: port >= 1 && port <= 65535 ? port : 22, username,
        auth: pick(row.auth, ['password', 'key'], 'password'), password: '', keyPath: String(row.key_path || '').trim(), passphrase: '',
        forwards: forwardsFromText(row.forwards)
      }
    };
  }
  if (kind === 'serial') {
    const portPath = String(row.serial_port || '').trim();
    if (!portPath) return { error: 'a serial row has no serial_port' };
    return {
      host: {
        type: 'serial', name: name || portPath, path: portPath,
        baudRate: parseInt(row.baud_rate, 10) > 0 ? parseInt(row.baud_rate, 10) : 115200,
        dataBits: [5, 6, 7, 8].includes(parseInt(row.data_bits, 10)) ? parseInt(row.data_bits, 10) : 8,
        parity: pick(row.parity, ['none', 'even', 'odd', 'mark', 'space'], 'none'),
        stopBits: [1, 1.5, 2].includes(parseFloat(row.stop_bits)) ? parseFloat(row.stop_bits) : 1,
        flow: pick(row.flow_control, ['none', 'rtscts', 'xonxoff'], 'none'),
        lineEnding: pick(row.line_ending, ['cr', 'lf', 'crlf'], 'cr'),
        localEcho: yes(row.local_echo)
      }
    };
  }
  if (kind === 'snippet') {
    const command = String(row.command || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    if (!command.trim()) return { error: 'a snippet row has no command' };
    return { snippet: { name: name || command.split('\n')[0].slice(0, 40), command, run: yes(row.press_enter) } };
  }
  return { error: kind ? `unknown kind "${kind}"` : 'a row has no kind (ssh, serial or snippet)' };
}

/* ---------------- .coosnip ---------------- */

function toCoosnip(snippets) {
  return JSON.stringify({
    coosnip: 1,
    snippets: snippets.map(s => ({ name: s.name, command: s.command, run: !!s.run }))
  }, null, 2) + '\n';
}

function parseCoosnip(text) {
  const data = JSON.parse(text.replace(/^﻿/, ''));
  const list = Array.isArray(data) ? data : data && Array.isArray(data.snippets) ? data.snippets : null;
  if (!list) throw new Error('this is not a .coosnip file');
  return list.map(s => rowToItem({ kind: 'snippet', name: s && s.name, command: s && s.command, press_enter: s && s.run ? 'yes' : 'no' }));
}

/* ---------------- Import ---------------- */

const sameHost = (a, b) => a.type === b.type && (a.name || '') === (b.name || '') && (a.type === 'ssh'
  ? a.host === b.host && (a.port || 22) === (b.port || 22) && (a.username || '') === (b.username || '')
  : a.path === b.path && (a.baudRate || 115200) === (b.baudRate || 115200));

// Add what the file holds, skipping anything already present. Never changes or removes existing entries.
async function importSharedText(text, fileName) {
  let items;
  try {
    const looksJson = /^\s*﻿?\s*[[{]/.test(text);
    items = looksJson || /\.coosnip$/i.test(fileName || '') ? parseCoosnip(text) : parseCsv(text).map(rowToItem);
  } catch (err) {
    toast(`Could not read ${fileName || 'the file'}: ${err.message}`, 'error');
    return null;
  }
  if (!items.length) {
    toast(`${fileName || 'The file'} has nothing to import.`, 'error');
    return null;
  }

  const result = { hosts: 0, snippets: 0, existing: 0, invalid: 0, firstError: '' };
  const newHosts = items.filter(i => i.host);
  const newSnips = items.filter(i => i.snippet);
  for (const i of items) if (i.error) { result.invalid++; result.firstError = result.firstError || i.error; }

  if (newHosts.length) {
    if (!hostsLoaded) await loadHosts();
    let n = 0;
    for (const { host } of newHosts) {
      if (state.hosts.some(h => sameHost(h, host))) { result.existing++; continue; }
      state.hosts.push({ id: 'h' + Date.now() + '-' + (n++), ...host });
      result.hosts++;
    }
    if (result.hosts) await persistHosts();
  }

  if (newSnips.length) {
    await ensureSnippets();
    let n = 0;
    for (const { snippet } of newSnips) {
      if (snip.items.some(s => s.name === snippet.name && s.command === snippet.command)) { result.existing++; continue; }
      snip.items.push({ id: 'sn' + Date.now() + '-' + (n++), ...snippet });
      result.snippets++;
    }
    if (result.snippets) persistSnippets();
  }

  const parts = [];
  if (result.hosts) parts.push(`${result.hosts} connection${result.hosts === 1 ? '' : 's'}`);
  if (result.snippets) parts.push(`${result.snippets} snippet${result.snippets === 1 ? '' : 's'}`);
  let msg = parts.length ? `Imported ${parts.join(' and ')}` : 'Nothing new to import';
  if (result.existing) msg += ` — ${result.existing} already here`;
  if (result.invalid) msg += ` — ${result.invalid} row${result.invalid === 1 ? '' : 's'} skipped (${result.firstError})`;
  if (result.hosts && newHosts.some(i => i.host.type === 'ssh')) msg += '. Passwords are not part of a shared file: edit each SSH host to add yours.';
  toast(msg, result.invalid && !parts.length ? 'error' : 'info');
  if (result.snippets && sideOpen !== 'snippets') setSide('snippets');
  return result;
}

async function importSharedFile() {
  const res = await window.api.openTextFile({
    title: 'Import connections or snippets',
    filters: [{ name: 'CooTerm exports', extensions: ['csv', 'coosnip'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (!res.ok) {
    if (!res.cancelled) toast(`Could not open the file: ${res.error}`, 'error');
    return;
  }
  await importSharedText(res.content, res.name);
}

/* ---------------- Export ---------------- */

const fileStamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function saveShared(defaultName, filters, content, what) {
  const res = await window.api.saveTextFile({ title: `Export ${what}`, defaultName, filters, content });
  if (res.ok) toast(`Exported ${what} to ${res.file}`);
  else if (!res.cancelled) toast(`Export failed: ${res.error}`, 'error');
  return res;
}

const CSV_FILTER = [{ name: 'CSV (spreadsheet)', extensions: ['csv'] }];
const COOSNIP_FILTER = [{ name: 'CooTerm snippets', extensions: ['coosnip'] }];

// which: 'all' | 'hosts' | 'snippets'
async function exportCsv(which) {
  if (!hostsLoaded) await loadHosts();
  await ensureSnippets();
  const rows = [];
  if (which !== 'snippets') rows.push(...state.hosts.map(hostToRow));
  if (which !== 'hosts') rows.push(...snip.items.map(snippetToRow));
  if (!rows.length) { toast('There is nothing to export yet.', 'error'); return; }
  const label = { all: 'setup', hosts: 'connections', snippets: 'snippets' }[which];
  const hosts = rows.filter(r => r.kind !== 'snippet').length;
  const snippets = rows.length - hosts;
  const what = [hosts ? `${hosts} connection${hosts === 1 ? '' : 's'}` : '', snippets ? `${snippets} snippet${snippets === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  await saveShared(`cooterm-${label}-${fileStamp()}.csv`, CSV_FILTER, toCsv(rows), what);
}

async function exportCoosnip(snippets, defaultName) {
  if (!snippets.length) { toast('There are no snippets to share yet.', 'error'); return; }
  const what = snippets.length === 1 ? `"${snippets[0].name}"` : `${snippets.length} snippets`;
  await saveShared(defaultName, COOSNIP_FILTER, toCoosnip(snippets), what);
}

const shareSnippet = s => exportCoosnip([s], `${s.name.replace(/[^\w .()-]+/g, '_').trim().slice(0, 60) || 'snippet'}.coosnip`);

/* ---------------- Menus and drag-and-drop ---------------- */

const menuBelow = btn => {
  const r = btn.getBoundingClientRect();
  return [r.left, r.bottom + 4];
};

$('#btn-share').addEventListener('click', ev => showMenu(...menuBelow(ev.currentTarget), [
  { label: 'Import from CSV or .coosnip…', action: importSharedFile },
  'sep',
  { label: 'Export everything (CSV)…', action: () => exportCsv('all') },
  { label: 'Export connections only (CSV)…', action: () => exportCsv('hosts') },
  { label: 'Export snippets only (CSV)…', action: () => exportCsv('snippets') }
]));

$('#snip-more').addEventListener('click', ev => showMenu(...menuBelow(ev.currentTarget), [
  { label: 'Import from CSV or .coosnip…', action: importSharedFile },
  'sep',
  { label: 'Share all as .coosnip…', action: async () => { await ensureSnippets(); exportCoosnip(snip.items, `cooterm-snippets-${fileStamp()}.coosnip`); } },
  { label: 'Export all as CSV…', action: () => exportCsv('snippets') }
]));

// Drop a .coosnip or .csv onto the Snippets panel to import it
const snipDrop = $('#side-snippets');
snipDrop.addEventListener('dragover', ev => {
  if (![...ev.dataTransfer.types].includes('Files')) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
  snipDrop.classList.add('dropping');
});
snipDrop.addEventListener('dragleave', ev => { if (!snipDrop.contains(ev.relatedTarget)) snipDrop.classList.remove('dropping'); });
snipDrop.addEventListener('drop', async ev => {
  snipDrop.classList.remove('dropping');
  ev.preventDefault();
  for (const file of [...ev.dataTransfer.files]) {
    if (file.size > 5 * 1024 * 1024) { toast(`${file.name} is too large to be a CooTerm export.`, 'error'); continue; }
    await importSharedText(await file.text(), file.name);
  }
});
