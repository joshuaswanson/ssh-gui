# SSH GUI

When I first started SSHing into remote servers, everything felt unintuitive. There was no visual feedback, no way to just browse around and see what was where. I spent more time looking up commands than actually getting work done. So I built this: a Finder-style GUI for remote servers that lets you browse files, manage folders, and handle common tasks visually, while keeping a full terminal right below. The idea is to give people coming from a GUI background a familiar starting point. As you get more comfortable, the terminal is always there, and you'll naturally start reaching for it. If you know how to use Finder on macOS, you already know how to use this.

## Features

- **Column browser** -- Navigate remote filesystems in a multi-column Finder-style view
- **Integrated terminal** -- Full terminal via xterm.js and WebSocket, with click-to-move-cursor support
- **SSH config support** -- Auto-discovers hosts from `~/.ssh/config` (including ProxyJump)
- **Tmux GUI** -- Visual tmux manager with window tabs above the terminal; create, switch, rename, close windows and split panes from the tab bar
- **Package manager** -- Built-in Python package manager panel; detects uv/pip, lists installed packages, install/uninstall with venv support
- **Sidebar shortcuts** -- Finder-style sidebar for quick folder navigation; drag folders to bookmark them, click to jump
- **Multi-select** -- Click to select, Shift+click or Shift+Arrow for range selection
- **Drag-and-drop** -- Move files/folders by dragging between columns, or drag folders onto the sidebar to bookmark them
- **File permissions** -- Interactive chmod toggles with R/W/X pills per owner/group/others
- **Sorting** -- Sort by name, kind (extension), or size
- **File preview** -- View text files and images in the info panel
- **Resizable columns** -- Drag column borders to resize
- **Light/dark themes** -- Toggle between light and dark mode

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
