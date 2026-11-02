<p align="center">
  <img src="static/logo-wordmark.svg" alt="SSH GUI" width="360">
</p>

<p align="center">A Finder-style GUI for remote servers. Browse and manage files over SSH in a column view, with a full terminal below.</p>

## Setup

Requires Python 3.10+ and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run app.py
```

Then open [http://localhost:8022](http://localhost:8022) in your browser.

## macOS app

```bash
brew install librsvg
./macos/build.sh
```

This creates `dist/SSH GUI.app`, a standalone app that needs no Python or uv. Drag it to Applications.

## Dependencies

- Flask + Flask-SocketIO (web server and WebSocket)
- Paramiko (SSH/SFTP client)
- pywebview (native macOS window)
- PyInstaller (macOS app bundle)
- xterm.js and the Socket.IO client (bundled in `static/vendor`)

## Support

If you find this useful, [buy me a coffee](https://buymeacoffee.com/swanson).

<img src="assets/bmc_qr.png" alt="Buy Me a Coffee QR" width="200">
