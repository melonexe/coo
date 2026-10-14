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
  'Tokyo Night': {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', cursorAccent: '#1a1b26',
    selectionBackground: '#33467c',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#9fe044',
    brightYellow: '#faba4a', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff',
    brightCyan: '#a4daff', brightWhite: '#c0caf5'
  },
  'Catppuccin Mocha': {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
    selectionBackground: '#45475a',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5', brightWhite: '#a6adc8'
  },
  'Rosé Pine': {
    background: '#191724', foreground: '#e0def4', cursor: '#e0def4', cursorAccent: '#191724',
    selectionBackground: '#403d52',
    black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177',
    blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
    brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f',
    brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7',
    brightCyan: '#ebbcba', brightWhite: '#e0def4'
  },
  'Synthwave ’84': {
    background: '#262335', foreground: '#f0eff1', cursor: '#ff7edb', cursorAccent: '#262335',
    selectionBackground: '#463465',
    black: '#1a1626', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d',
    blue: '#36f9f6', magenta: '#ff7edb', cyan: '#03edf9', white: '#f0eff1',
    brightBlack: '#614d85', brightRed: '#ff6e78', brightGreen: '#9bf7cf',
    brightYellow: '#fff08a', brightBlue: '#7bfbf9', brightMagenta: '#ffa6e8',
    brightCyan: '#6ff4fb', brightWhite: '#ffffff'
  },
  'Kanagawa': {
    background: '#1f1f28', foreground: '#dcd7ba', cursor: '#c8c093', cursorAccent: '#1f1f28',
    selectionBackground: '#2d4f67',
    black: '#16161d', red: '#c34043', green: '#76946a', yellow: '#c0a36e',
    blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093',
    brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c',
    brightYellow: '#e6c384', brightBlue: '#7fb4ca', brightMagenta: '#938aa9',
    brightCyan: '#7aa89f', brightWhite: '#dcd7ba'
  },
  'Everforest': {
    background: '#2d353b', foreground: '#d3c6aa', cursor: '#d3c6aa', cursorAccent: '#2d353b',
    selectionBackground: '#4c3743',
    black: '#343f44', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f',
    blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d3c6aa',
    brightBlack: '#859289', brightRed: '#e67e80', brightGreen: '#a7c080',
    brightYellow: '#dbbc7f', brightBlue: '#7fbbb3', brightMagenta: '#d699b6',
    brightCyan: '#83c092', brightWhite: '#e4dcc8'
  },
  'Night Owl': {
    background: '#011627', foreground: '#d6deeb', cursor: '#80a4c2', cursorAccent: '#011627',
    selectionBackground: '#1d3b53',
    black: '#011627', red: '#ef5350', green: '#22da6e', yellow: '#c5e478',
    blue: '#82aaff', magenta: '#c792ea', cyan: '#21c7a8', white: '#ffffff',
    brightBlack: '#575656', brightRed: '#ef5350', brightGreen: '#22da6e',
    brightYellow: '#ffeb95', brightBlue: '#82aaff', brightMagenta: '#c792ea',
    brightCyan: '#7fdbca', brightWhite: '#ffffff'
  },
  'One Dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
    selectionBackground: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e88a92', brightGreen: '#b1d196',
    brightYellow: '#ecd09f', brightBlue: '#8cc4f4', brightMagenta: '#d69ae7',
    brightCyan: '#7fcbd5', brightWhite: '#ffffff'
  },
  'Neon Cyberpunk': {
    background: '#0b0221', foreground: '#e4f2ff', cursor: '#00fff0', cursorAccent: '#0b0221',
    selectionBackground: '#3b1670',
    black: '#120533', red: '#ff2a6d', green: '#05ffa1', yellow: '#f9f871',
    blue: '#2d7bff', magenta: '#ff00e4', cyan: '#00fff0', white: '#d1c4f6',
    brightBlack: '#5a3d8a', brightRed: '#ff5c8f', brightGreen: '#5cffc0',
    brightYellow: '#fffd9e', brightBlue: '#6aa2ff', brightMagenta: '#ff5cf0',
    brightCyan: '#7afff8', brightWhite: '#ffffff'
  },
  'Deep Ocean': {
    background: '#0a1a24', foreground: '#c4e3ea', cursor: '#4fd6be', cursorAccent: '#0a1a24',
    selectionBackground: '#16435a',
    black: '#0f2633', red: '#f07178', green: '#4fd6be', yellow: '#ffcb6b',
    blue: '#3fa7e0', magenta: '#a48bf0', cyan: '#5ce1e6', white: '#c4e3ea',
    brightBlack: '#3b6276', brightRed: '#ff8f95', brightGreen: '#7eecd6',
    brightYellow: '#ffdc93', brightBlue: '#76c4f0', brightMagenta: '#c2b0ff',
    brightCyan: '#94f0f2', brightWhite: '#effbfd'
  },
  'Sunset': {
    background: '#1f1520', foreground: '#f5dccb', cursor: '#ff9e64', cursorAccent: '#1f1520',
    selectionBackground: '#4f2e45',
    black: '#2a1c2b', red: '#ff5f6d', green: '#b8d97f', yellow: '#ffc371',
    blue: '#7aa6ff', magenta: '#f78fb3', cyan: '#6fd3c7', white: '#f5dccb',
    brightBlack: '#6e4f66', brightRed: '#ff8a94', brightGreen: '#d0eba3',
    brightYellow: '#ffd89b', brightBlue: '#a3c2ff', brightMagenta: '#ffb3cf',
    brightCyan: '#9ae5dc', brightWhite: '#fff4ec'
  },
  'Phosphor Green': {
    background: '#020a03', foreground: '#33ff66', cursor: '#33ff66', cursorAccent: '#020a03',
    selectionBackground: '#0f4a1c',
    black: '#031a07', red: '#7dff9e', green: '#33ff66', yellow: '#a8ffbd',
    blue: '#1fcc4d', magenta: '#66ff8c', cyan: '#4dffa6', white: '#b3ffc6',
    brightBlack: '#1a7a33', brightRed: '#a8ffbd', brightGreen: '#66ff8c',
    brightYellow: '#ccffd9', brightBlue: '#4dff79', brightMagenta: '#99ffb3',
    brightCyan: '#80ffbf', brightWhite: '#e6ffec'
  },
  'Amber CRT': {
    background: '#140c00', foreground: '#ffb000', cursor: '#ffb000', cursorAccent: '#140c00',
    selectionBackground: '#4d3300',
    black: '#1f1400', red: '#ff7a1a', green: '#ffc233', yellow: '#ffd466',
    blue: '#cc8a00', magenta: '#ff9933', cyan: '#ffcc4d', white: '#ffe0a3',
    brightBlack: '#7a5200', brightRed: '#ff9d52', brightGreen: '#ffd166',
    brightYellow: '#ffe299', brightBlue: '#e6a21a', brightMagenta: '#ffb366',
    brightCyan: '#ffdb80', brightWhite: '#fff3d6'
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
  },
  'Catppuccin Latte (light)': {
    background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', cursorAccent: '#eff1f5',
    selectionBackground: '#ccd0da',
    black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
    blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
    brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b',
    brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb',
    brightCyan: '#179299', brightWhite: '#bcc0cc'
  },
  'Rosé Pine Dawn (light)': {
    background: '#faf4ed', foreground: '#575279', cursor: '#575279', cursorAccent: '#faf4ed',
    selectionBackground: '#dfdad9',
    black: '#f2e9e1', red: '#b4637a', green: '#286983', yellow: '#ea9d34',
    blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279',
    brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983',
    brightYellow: '#ea9d34', brightBlue: '#56949f', brightMagenta: '#907aa9',
    brightCyan: '#d7827e', brightWhite: '#575279'
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
