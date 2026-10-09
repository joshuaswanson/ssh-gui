import os

from sshgui import create_app, socketio

if __name__ == "__main__":
    port = int(os.environ.get("SSH_GUI_PORT", "8022"))
    debug = os.environ.get("SSH_GUI_DEBUG") == "1"
    app = create_app(port)
    print(f"\n  Open in your browser: http://localhost:{port}\n")
    socketio.run(app, debug=debug, host="127.0.0.1", port=port, allow_unsafe_werkzeug=True)
