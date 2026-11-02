<p align="center">
  <img src="static/logo-wordmark.svg" alt="SSH GUI" width="360">
</p>

<p align="center">A Finder-style GUI for remote servers. Browse and manage files over SSH in a column view, with a full terminal below.</p>

## Setup

Requires macOS and [uv](https://docs.astral.sh/uv/).

```bash
brew install librsvg
./macos/build.sh
```

This creates `dist/SSH GUI.app`, a standalone app. Drag it to Applications.

## Dependencies

- Flask + Flask-SocketIO (web server and WebSocket)
- Paramiko (SSH/SFTP client)
- pywebview (native macOS window)
- PyInstaller (macOS app bundle)
- xterm.js and the Socket.IO client (bundled in `static/vendor`)

## Support

If you find this useful, [buy me a coffee](https://buymeacoffee.com/swanson).

<img src="assets/bmc_qr.png" alt="Buy Me a Coffee QR" width="200">
