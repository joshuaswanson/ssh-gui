import atexit
import traceback
from pathlib import Path
from urllib.parse import urlsplit

import paramiko
from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO
from werkzeug.exceptions import HTTPException

from .connections import close_all_connections

ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
LOCAL_HOSTNAMES = ("localhost", "127.0.0.1")

socketio = SocketIO()


def create_app(port):
    app = Flask(
        __name__,
        template_folder=str(ROOT / "templates"),
        static_folder=str(ROOT / "static"),
    )
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

    allowed_hosts = {f"{name}:{port}" for name in LOCAL_HOSTNAMES}

    # The server can run commands on every connected host, so a page from
    # another origin (or a DNS-rebound hostname) must never reach the API.
    @app.before_request
    def reject_foreign_requests():
        if request.host not in allowed_hosts:
            return jsonify({"error": "Forbidden host"}), 403
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc not in allowed_hosts:
            return jsonify({"error": "Forbidden origin"}), 403

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(PermissionError)
    def permission_denied(_):
        return jsonify({"error": "Permission denied"}), 403

    @app.errorhandler(FileNotFoundError)
    def not_found(_):
        return jsonify({"error": "No such file or directory"}), 404

    @app.errorhandler(Exception)
    def api_error(error):
        if isinstance(error, HTTPException):
            message = error.description
            if error.code == 413:
                message = f"Upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB"
            return jsonify({"error": message}), error.code
        expected = (OSError, EOFError, ValueError, paramiko.SSHException)
        if not isinstance(error, expected):
            traceback.print_exc()
            return jsonify({"error": str(error) or type(error).__name__}), 500
        return jsonify({"error": str(error) or type(error).__name__}), 400

    from . import files, hosts, packages, terminal, tmux  # noqa: F401

    for module in (hosts, files, tmux, packages):
        app.register_blueprint(module.bp)

    socketio.init_app(
        app,
        async_mode="threading",
        cors_allowed_origins=[f"http://{host}" for host in allowed_hosts],
    )
    atexit.register(close_all_connections)
    return app
