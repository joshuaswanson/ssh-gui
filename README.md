# SSH GUI

When I first started SSHing into remote servers, everything felt unintuitive. There was no visual feedback, no way to just browse around and see what was where. I spent more time looking up commands than actually getting work done. So I built this: a Finder-style GUI for remote servers that lets you browse files, manage folders, and handle common tasks visually, while keeping a full terminal right below. The idea is to give people coming from a GUI background a familiar starting point. As you get more comfortable, the terminal is always there, and you'll naturally start reaching for it. If you know how to use Finder on macOS, you already know how to use this.

## Features

- **Column browser** -- Navigate remote filesystems in a multi-column Finder-style view
- **Integrated terminal** -- Full terminal via xterm.js and WebSocket, with click-to-move-cursor support; snap-to-hide by dragging the resize handle to the bottom
- **File upload** -- Drag files from your desktop onto any column to upload, or right-click and choose Upload Files
- **Text editor** -- Click Edit on any text file preview to edit in-browser, then Cmd+S to save back to the server
- **Search/filter** -- Cmd+F to filter files by name across all visible columns
- **Back/forward navigation** -- Browser-style history with back/forward buttons and Cmd+[/] shortcuts
- **SSH config support** -- Auto-discovers hosts from `~/.ssh/config` (including ProxyJump); star up to 4 favorite hosts
- **Tmux GUI** -- Visual tmux manager with window tabs above the terminal; create, switch, rename, close windows and split panes from the tab bar
- **Package manager** -- Built-in Python package manager panel; detects uv/pip, lists installed packages, install/uninstall with venv support
- **Sidebar shortcuts** -- Drag folders or breadcrumb paths to bookmark them, drag to reorder, drag out to remove
- **Git integration** -- Shows current branch on the path bar, file creator in the info panel, and sort by creator groups files by git author
- **Multi-select** -- Click to select, Shift+click or Shift+Arrow for range selection; multi-select context menu with bulk delete
- **Drag-and-drop** -- Move files/folders by dragging between columns, or drag folders onto the sidebar to bookmark them
- **File download** -- Right-click any file to download it
- **Duplicate** -- Right-click any file or folder to duplicate it
- **File permissions** -- Interactive chmod toggles with R/W/X pills per owner/group/others
- **Sorting** -- Sort by name, kind (extension), size, or creator (git author)
- **File preview** -- View text files, images, and PDFs in the info panel
- **Context menus** -- Right-click for copy name/path, download, upload, duplicate, favorites, rename, delete
- **Keyboard shortcuts** -- Cmd+F (search), Cmd+S (save), Cmd+D (duplicate), Cmd+Shift+N (new folder), Cmd+Backspace (delete), Cmd+[/] (back/forward)
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

## Support

If you find this useful, [buy me a coffee](https://buymeacoffee.com/swanson).

<img src="assets/bmc_qr.png" alt="Buy Me a Coffee QR" width="200">
