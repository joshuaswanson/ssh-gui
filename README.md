# SSH GUI

I have a computer science degree and I still can't remember any CLI commands beyond `cd` and `ls`. Every time I need to do something on a remote server it's 5 minutes of Googling basic commands I've already Googled 400 times. So I built this - a nice GUI that lets me SSH into a remote server and do all the common file operations by just clicking around like a normal person. The terminal is still there for when I'm feeling brave.

## Features

- **Column browser** -- Navigate remote filesystems in a multi-column Finder-style view
- **Integrated terminal** -- Full terminal via xterm.js and WebSocket, with click-to-move-cursor support; snap-to-hide by dragging the resize handle to the bottom
- **SSH config support** -- Auto-discovers hosts from `~/.ssh/config` (including ProxyJump); star up to 4 favorite hosts
- **Tmux GUI** -- Visual tmux manager with window tabs above the terminal; create, switch, rename, close windows and split panes from the tab bar
- **Package manager** -- Built-in Python package manager panel; detects uv/pip, lists installed packages, install/uninstall with venv support
- **Sidebar shortcuts** -- Drag folders or breadcrumb paths to bookmark them, drag out to remove; home directory seeded as default
- **Git integration** -- Shows current branch on the path bar, file creator in the info panel, and sort by creator groups files by git author
- **Multi-select** -- Click to select, Shift+click or Shift+Arrow for range selection; multi-select context menu with bulk delete
- **Drag-and-drop** -- Move files/folders by dragging between columns, or drag folders onto the sidebar to bookmark them
- **File download** -- Right-click any file to download it
- **File permissions** -- Interactive chmod toggles with R/W/X pills per owner/group/others
- **Sorting** -- Sort by name, kind (extension), size, or creator (git author)
- **File preview** -- View text files, images, and PDFs in the info panel
- **Context menus** -- Right-click files for copy name/path, download, favorites, rename, delete; right-click columns for new folder
- **Resizable columns** -- Drag column borders to resize
- **Light/dark themes** -- Toggle between light and dark mode
- **Client-side caching** -- API responses cached with TTL to reduce redundant server calls

## Setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run app.py
```

Then open [http://localhost:8022](http://localhost:8022) in your browser.

On macOS, double-click `start.command` to launch the server and open Safari automatically.

## Dependencies

- Flask + Flask-SocketIO (web server and WebSocket)
- Paramiko (SSH/SFTP client)
- xterm.js (terminal emulator, loaded via CDN)
