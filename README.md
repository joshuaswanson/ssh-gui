# SSH GUI

I have a computer science degree and I still can't remember any CLI commands beyond `cd` and `ls`. Every time I need to do something on a remote server it's 5 minutes of Googling basic commands I've already Googled 400 times. So I built this - a nice GUI that lets me SSH into a remote server and do all the common file operations by just clicking around like a normal person. The terminal is still there for when I'm feeling brave.

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
