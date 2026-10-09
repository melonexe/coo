/* Terminal appearance settings (font, theme, cursor…), kept in localStorage. */

const THEMES = {
  'CooTerm Dark': {
    background: '#14161b', foreground: '#d5dae4', cursor: '#4d9fff', cursorAccent: '#14161b',
    selectionBackground: '#2f4a7d',
    black: '#21252e', red: '#e5534b', green: '#3fb950', yellow: '#d4a72c',
    blue: '#3d7eff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#d5dae4',
    brightBlack: '#5a6374', brightRed: '#ff7b72', brightGreen: '#56d364',
    brightYellow: '#e3b341', brightBlue: '#79b8ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#ffffff'
  },
  'Midnight': {
    background: '#000000', foreground: '#e6e6e6', cursor: '#ffffff', cursorAccent: '#000000',
    selectionBackground: '#3a4a6b',
    black: '#000000', red: '#ff5c57', green: '#5af78e', yellow: '#f3f99d',
    blue: '#57c7ff', magenta: '#ff6ac1', cyan: '#9aedfe', white: '#f1f1f0',
    brightBlack: '#686868', brightRed: '#ff5c57', brightGreen: '#5af78e',
    brightYellow: '#f3f99d', brightBlue: '#57c7ff', brightMagenta: '#ff6ac1',
    brightCyan: '#9aedfe', brightWhite: '#ffffff'
  },
  'Dracula': {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff'
  },
  'Nord': {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440',
    selectionBackground: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4'
  },
  'Monokai': {
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', cursorAccent: '#272822',
    selectionBackground: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e',
    brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4', brightWhite: '#f9f8f5'
  },
  'Gruvbox Dark': {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', cursorAccent: '#282828',
    selectionBackground: '#504945',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26',
    brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
    brightCyan: '#8ec07c', brightWhite: '#ebdbb2'
  },
  'Solarized Dark': {
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36',
    selectionBackground: '#0a4a5a',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#859900',
    brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#6c71c4',
    brightCyan: '#2aa198', brightWhite: '#fdf6e3'
  },
  'Solarized Light': {
    background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', cursorAccent: '#fdf6e3',
    selectionBackground: '#e3dcc6',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#657b83', brightRed: '#cb4b16', brightGreen: '#859900',
    brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#6c71c4',
    brightCyan: '#2aa198', brightWhite: '#002b36'
  },
  'Paper (light)': {
    background: '#ffffff', foreground: '#24292f', cursor: '#0969da', cursorAccent: '#ffffff',
    selectionBackground: '#b6d7ff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37',
    brightYellow: '#9a6700', brightBlue: '#218bff', brightMagenta: '#a475f9',
    brightCyan: '#3192aa', brightWhite: '#8c959f'
  }
};

const DEFAULT_SETTINGS = {
  theme: 'CooTerm Dark',
  fontFamily: 'Cascadia Mono',
  fontSize: 14,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 8000,
  rightClickPaste: true,
  logTimestamps: false
};

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('settings') || '{}') || {}; } catch {}
  const s = { ...DEFAULT_SETTINGS, ...saved };
  if (!THEMES[s.theme]) s.theme = DEFAULT_SETTINGS.theme;
  s.fontSize = clampNumber(s.fontSize, 8, 32, DEFAULT_SETTINGS.fontSize);
  s.scrollback = clampNumber(s.scrollback, 500, 200000, DEFAULT_SETTINGS.scrollback);
  return s;
}

function clampNumber(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const settings = loadSettings();

function saveSettings() {
  try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {}
}

function currentTheme() {
  return THEMES[settings.theme] || THEMES[DEFAULT_SETTINGS.theme];
}

function fontStack() {
  const name = String(settings.fontFamily || '').replace(/["\\]/g, '').trim();
  return (name ? `"${name}", ` : '') + '"Cascadia Mono", Consolas, monospace';
}

function terminalOptions() {
  return {
    fontFamily: fontStack(),
    fontSize: settings.fontSize,
    cursorBlink: settings.cursorBlink,
    cursorStyle: settings.cursorStyle,
    scrollback: settings.scrollback,
    theme: currentTheme()
  };
}

// Push the current settings to every open terminal. applyToPanes is provided by renderer.js.
function applySettings() {
  saveSettings();
  if (typeof applySettingsToPanes === 'function') applySettingsToPanes();
  renderSettingsPreview();
}

function renderSettingsPreview() {
  const box = $('#set-preview');
  if (!box) return;
  const t = currentTheme();
  box.style.background = t.background;
  box.style.color = t.foreground;
  box.style.fontFamily = fontStack();
  box.style.fontSize = settings.fontSize + 'px';
  box.innerHTML = '';
  const line = (...parts) => {
    const row = el('div');
    for (const [text, color] of parts) {
      const span = el('span', '', text);
      if (color) span.style.color = color;
      row.appendChild(span);
    }
    box.appendChild(row);
  };
  line(['admin@router-1', t.green], [':', t.foreground], ['~', t.blue], ['$ show interfaces status', t.foreground]);
  line(['Gi0/1  ', t.cyan], ['connected   ', t.green], ['1000  full', t.foreground]);
  line(['Gi0/2  ', t.cyan], ['notconnect  ', t.red], ['auto  auto', t.brightBlack]);
  line(['warning: ', t.yellow], ['2 ports err-disabled', t.magenta]);
}

function openSettings() {
  const themeSel = $('#set-theme');
  if (!themeSel.options.length) {
    for (const name of Object.keys(THEMES)) {
      const opt = el('option', '', name);
      opt.value = name;
      themeSel.appendChild(opt);
    }
  }
  themeSel.value = settings.theme;
  $('#set-cursor').value = settings.cursorStyle;
  $('#set-font').value = settings.fontFamily;
  $('#set-size').value = settings.fontSize;
  $('#set-scrollback').value = settings.scrollback;
  $('#set-blink').checked = settings.cursorBlink;
  $('#set-rightclick').checked = settings.rightClickPaste;
  $('#set-logts').checked = settings.logTimestamps;
  renderSettingsPreview();
  $('#settings-backdrop').classList.remove('hidden');
}

function closeSettings() {
  // Normalise anything left half-typed in the number boxes
  settings.fontSize = clampNumber($('#set-size').value, 8, 32, settings.fontSize);
  settings.scrollback = clampNumber($('#set-scrollback').value, 500, 200000, settings.scrollback);
  applySettings();
  $('#settings-backdrop').classList.add('hidden');
}

function changeFontSize(delta) {
  settings.fontSize = delta === 0 ? DEFAULT_SETTINGS.fontSize : clampNumber(settings.fontSize + delta, 8, 32, settings.fontSize);
  applySettings();
}

$('#set-theme').addEventListener('change', ev => { settings.theme = ev.target.value; applySettings(); });
$('#set-cursor').addEventListener('change', ev => { settings.cursorStyle = ev.target.value; applySettings(); });
$('#set-font').addEventListener('input', ev => { settings.fontFamily = ev.target.value; applySettings(); });
$('#set-size').addEventListener('input', ev => {
  const n = parseInt(ev.target.value, 10);
  if (n >= 8 && n <= 32) { settings.fontSize = n; applySettings(); }
});
$('#set-scrollback').addEventListener('change', ev => {
  settings.scrollback = clampNumber(ev.target.value, 500, 200000, settings.scrollback);
  ev.target.value = settings.scrollback;
  applySettings();
});
$('#set-blink').addEventListener('change', ev => { settings.cursorBlink = ev.target.checked; applySettings(); });
$('#set-rightclick').addEventListener('change', ev => { settings.rightClickPaste = ev.target.checked; applySettings(); });
$('#set-logts').addEventListener('change', ev => { settings.logTimestamps = ev.target.checked; applySettings(); });
$('#set-reset').addEventListener('click', () => {
  Object.assign(settings, DEFAULT_SETTINGS);
  applySettings();
  openSettings();
});
$('#set-done').addEventListener('click', closeSettings);
$('#settings-backdrop').addEventListener('mousedown', ev => { if (ev.target === ev.currentTarget) closeSettings(); });
