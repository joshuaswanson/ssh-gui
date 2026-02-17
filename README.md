# SSH GUI

A web-based SSH file browser and terminal. Connects to remote servers via SSH and provides a Finder-like column view for navigating the filesystem, alongside an integrated terminal.

## Features

- **Column browser** -Navigate remote filesystems in a multi-column Finder-style view
- **Integrated terminal** -Full terminal via xterm.js and WebSocket
- **SSH config support** -Auto-discovers hosts from `~/.ssh/config` (including ProxyJump)
- **Multi-select** -Click to select, Shift+click or Shift+Arrow for range selection
- **Drag-and-drop** -Move files/folders by dragging between columns
- **Sorting** -Sort by name, kind (extension), or size
- **File preview** -View text file contents in the info panel
- **Resizable columns** -Drag column borders to resize

## Setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run app.py
```

Then open [http://localhost:8022](http://localhost:8022) in your browser.

## Dependencies

- Flask + Flask-SocketIO (web server and WebSocket)
- Paramiko (SSH/SFTP client)
- xterm.js (terminal emulator, loaded via CDN)
