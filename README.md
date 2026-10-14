# CooTerm

A Termius-style SSH + **Serial** terminal for Windows, built with Electron. Serial support (the feature Termius puts behind its paid plan) is first-class here.

![Stack](https://img.shields.io/badge/stack-Electron%20%2B%20xterm.js-3d7eff)

## Features

- **Serial terminal** — connect to COM ports with configurable baud rate, data bits, parity, stop bits, and flow control (RTS/CTS or XON/XOFF)
  - Auto-detected port list in the sidebar (one click connects at 115200 8N1)
  - Local echo toggle for devices that don't echo input
  - Configurable line ending on Enter (CR / LF / CR+LF)
- **SSH client** — password, private-key, and keyboard-interactive auth via `ssh2`
- **Local terminal** — PowerShell / Command Prompt tabs via ConPTY (`@lydell/node-pty`), handy for ping/traceroute from your own machine
- **Connection popup** — Termius-style spinner while connecting, with cancel/retry and a persistent **verbose log** toggle that shows the full SSH handshake/auth trail when a connection fails
- **Saved hosts** with search, edit, and delete (Termius-style sidebar)
- **Tabs and split panes** — run sessions side by side in one tab (split right / split down, drag the divider to resize); double-click a tab to rename it, drag tabs to reorder, middle-click to close
  - Shift+right-click a terminal (or the ⋯ that appears on a split pane) for the pane menu: split, zoom one pane to fill the tab, make panes equal size, move a pane to its own tab or window, close it or every other pane
  - Hovering a split pane shows a ✕ to close just that pane; the pane next to it takes over its space and the focus
- **Multiple windows** — drag a tab out of the window to give it a window of its own, or drop it on another CooTerm window to move it there (like a browser). Sessions keep running and keep their scrollback while they move. Ctrl+Shift+N opens a new empty window
- **Collapsible sidebar** — hide the hosts sidebar (button at the left of the tab bar, or Ctrl+Shift+B) for more terminal space
- **Reconnect in place** — a closed or failed session stays on screen with its history; press Enter to reconnect
- **Find in all terminals** — browser-style find bar that searches the scrollback of every open terminal, steps between matches across tabs and panes, and shows a per-terminal match count
- **Files (SFTP)** — browse, upload (button or drag from Explorer), download files or whole folders (right-click a folder), rename, delete and create folders on the focused SSH session
  - Quick preview: select a file and press Space to read it without downloading (Space or Esc closes it, the arrow keys move to the next file). The first 256 KB loads at once; scroll past the end to load the whole file (up to 100 MB). Ctrl+F finds text in it
  - Hosts without SFTP (common on embedded devices) fall back automatically to shell commands for browsing and SCP for transfers, or plain `cat` where SCP is missing too
- **Port forwarding** — local, remote and dynamic (SOCKS5) rules saved per SSH host
- **Snippets** — saved commands sent to the focused terminal with one click; share one (or all) as a `.coosnip` file
  - A line `sleep 5` in a snippet waits 5 seconds before the next lines are sent (`sleep 500ms` for milliseconds); it is not sent itself. Click a running snippet to stop it. To send a real `sleep` command, write it another way, e.g. `\sleep 5` or `sleep 5;`
  - Folders (optional): pick or type a folder in the snippet editor, drag snippets onto a folder (or onto the empty part of the list to take them out), or right-click a snippet → Move to folder. Folders open and close with a click, can be renamed, removed (keeping their snippets) or shared as one `.coosnip`. Folders travel with CSV and `.coosnip` exports
  - Variables: `{{name}}` asks for a value each time the snippet runs, and `{{name=default}}` fills in a default. A name used more than once is asked for once, and the dialog remembers the last values you typed (until CooTerm closes). Example: `show interface {{interface=Gi0/1}}`
- **Import / export** — connections (SSH and serial) and snippets as one CSV file, to hand your setup to someone else. Passwords and passphrases are never exported
- **Session logging** — record a session to a plain-text file (escape codes stripped, optional per-line timestamps); the log carries on across reconnects
- **Terminal settings** — themes, font, size, cursor, scrollback
- Full xterm.js terminal: 256 colors, scrollback, clickable links (open in your browser), right-click copy/paste
- Passwords/passphrases are encrypted at rest with Windows DPAPI (Electron `safeStorage`)

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+F | Find in all terminals (Enter / Shift+Enter or F3 / Shift+F3 to step, Esc to close) |
| Ctrl+Shift+D / Ctrl+Shift+E | Split right / split down |
| Ctrl+Shift+W | Close the focused pane (the tab closes with its last pane) |
| Ctrl+Shift+M | Zoom the focused pane to fill the tab / restore the layout |
| Shift+right-click | Pane menu (split, zoom, move, close…) |
| Ctrl+Shift+B | Hide / show the hosts sidebar |
| Ctrl+Shift+N | New window |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Shift+C / Ctrl+Shift+V | Copy / paste |
| Ctrl+= / Ctrl+- / Ctrl+0 | Bigger / smaller / default font size |
| Enter (in a closed session) | Reconnect |
| Space (in the Files panel) | Preview the selected file; arrows move, Enter opens or downloads, Backspace goes up |
| Ctrl+F (in a file preview) | Find in the previewed file |
| F12 | Developer tools |

## Run

```powershell
npm install
npm start
```

## Build a Windows installer / portable exe

```powershell
npm run dist
```

Output lands in `dist/` (NSIS installer + portable exe).

## Where data lives

Saved hosts (including their port-forwarding rules): `%APPDATA%/cooterm/hosts.json`. Secret fields are DPAPI-encrypted, so the file is only readable by your Windows user account. Snippets live next to it in `snippets.json`.

## Notes / roadmap

- Host key verification UI, folder upload over SFTP, and a keychain for reusable identities are possible next steps

## Sharing a setup

The **⋯** button next to **+ New** exports everything to a CSV file and imports it again; the same menu in the Snippets panel handles snippets on their own. Importing only ever adds: anything already present is left alone.

The CSV has one row per item, told apart by the `kind` column, and can be edited in Excel:

| Column | Used by | Notes |
| --- | --- | --- |
| `kind` | all | `ssh`, `serial` or `snippet` |
| `name` | all | label shown in the app |
| `host`, `port`, `username` | ssh | port defaults to 22 |
| `auth`, `key_path` | ssh | `password` or `key` |
| `forwards` | ssh | e.g. `L:8080:10.0.0.5:80; R:9000:localhost:22; D:1080` |
| `serial_port`, `baud_rate`, `data_bits`, `parity`, `stop_bits`, `flow_control`, `line_ending`, `local_echo` | serial | defaults: 115200, 8, none, 1, none, cr, no |
| `command`, `press_enter` | snippet | `press_enter` is `yes` or `no` |

A `.coosnip` file is a small JSON file holding just snippets. Use the share icon on a snippet to make one, and drop it onto the Snippets panel (or use Import) to add it.
