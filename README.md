# SSH GUI

A Finder-style GUI for remote servers. Browse and manage files over SSH in a column view, with a full terminal below.

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
- xterm.js and the Socket.IO client (bundled in `static/vendor`)

## Support

If you find this useful, [buy me a coffee](https://buymeacoffee.com/swanson).

<img src="assets/bmc_qr.png" alt="Buy Me a Coffee QR" width="200">
