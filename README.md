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
- **Tabs** — run multiple sessions side by side; middle-click or Ctrl+W to close
- Full xterm.js terminal: 256 colors, scrollback, clickable links, Ctrl+Shift+C/V copy-paste
- Passwords/passphrases are encrypted at rest with Windows DPAPI (Electron `safeStorage`)

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

Saved hosts: `%APPDATA%/cooterm/hosts.json`. Secret fields are DPAPI-encrypted, so the file is only readable by your Windows user account.

## Notes / roadmap

- SFTP file panel, port forwarding, and host key verification UI are possible next steps
