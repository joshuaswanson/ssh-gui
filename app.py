import os
import stat
import time
import posixpath
import threading
from pathlib import Path

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import paramiko

app = Flask(__name__)
app.secret_key = os.urandom(24)
socketio = SocketIO(app, async_mode="threading", cors_allowed_origins="*")

# Single-user SSH state
ssh_state = {
    "client": None,
    "jump_client": None,
    "sftp": None,
    "channel": None,
    "home_dir": None,
    "host": None,
}


def parse_ssh_config():
    config_path = Path.home() / ".ssh" / "config"
    if not config_path.exists():
        return []

    config = paramiko.SSHConfig()
    with open(config_path) as f:
        config.parse(f)

    hosts = []
    for hostname in config.get_hostnames():
        if "*" in hostname or "?" in hostname:
            continue
        info = config.lookup(hostname)
        identity = ""
        if info.get("identityfile"):
            identity = info["identityfile"][0]
        hosts.append(
            {
                "name": hostname,
                "hostname": info.get("hostname", hostname),
                "user": info.get("user", os.environ.get("USER", "")),
                "port": int(info.get("port", 22)),
                "identity_file": identity,
            }
        )

    return sorted(hosts, key=lambda h: h["name"])


def cleanup_connection():
    for key in ("channel", "sftp", "client", "jump_client"):
        if ssh_state.get(key):
            try:
                ssh_state[key].close()
            except Exception:
                pass
            ssh_state[key] = None
    ssh_state["home_dir"] = None
    ssh_state["host"] = None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/ssh-configs")
def get_ssh_configs():
    configs = parse_ssh_config()
    return jsonify(
        {
            "hosts": configs,
            "default_user": os.environ.get("USER", ""),
        }
    )


@app.route("/api/connect", methods=["POST"])
def connect():
    data = request.json
    hostname = data.get("hostname", "")
    username = data.get("username", "")
    password = data.get("password", "")
    port = int(data.get("port", 22))
    key_file = data.get("key_file", "")
    config_host = data.get("config_host", "")

    # If using SSH config, look up the host
    jump_config = None
    if config_host:
        config_path = Path.home() / ".ssh" / "config"
        if config_path.exists():
            config = paramiko.SSHConfig()
            with open(config_path) as f:
                config.parse(f)
            info = config.lookup(config_host)
            hostname = info.get("hostname", config_host)
            username = username or info.get("user", os.environ.get("USER", ""))
            port = int(info.get("port", port))
            if not key_file and info.get("identityfile"):
                key_file = info["identityfile"][0]
            if info.get("proxyjump"):
                jump_host = info["proxyjump"]
                jump_info = config.lookup(jump_host)
                jump_config = {
                    "hostname": jump_info.get("hostname", jump_host),
                    "port": int(jump_info.get("port", 22)),
                    "user": jump_info.get("user", os.environ.get("USER", "")),
                    "identityfile": jump_info.get("identityfile", []),
                }

    cleanup_connection()

    try:
        sock = None

        # Handle ProxyJump: connect to jump host first, tunnel through it
        if jump_config:
            print(f"  Connecting to jump host {jump_config['user']}@{jump_config['hostname']}:{jump_config['port']}...")
            jump_client = paramiko.SSHClient()
            jump_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            jump_client.load_system_host_keys()

            jump_kwargs = {
                "hostname": jump_config["hostname"],
                "port": jump_config["port"],
                "username": jump_config["user"],
                "timeout": 30,
                "allow_agent": True,
                "look_for_keys": True,
            }
            if jump_config["identityfile"]:
                expanded = os.path.expanduser(jump_config["identityfile"][0])
                if os.path.exists(expanded):
                    jump_kwargs["key_filename"] = expanded

            jump_client.connect(**jump_kwargs)
            ssh_state["jump_client"] = jump_client
            print(f"  Jump host connected. Tunneling to {hostname}:{port}...")

            jump_transport = jump_client.get_transport()
            sock = jump_transport.open_channel(
                "direct-tcpip", (hostname, port), ("127.0.0.1", 0)
            )

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.load_system_host_keys()

        connect_kwargs = {
            "hostname": hostname,
            "port": port,
            "username": username,
            "timeout": 30,
        }

        if sock:
            connect_kwargs["sock"] = sock

        if key_file:
            expanded_key = os.path.expanduser(key_file)
            if os.path.exists(expanded_key):
                connect_kwargs["key_filename"] = expanded_key
                if password:
                    connect_kwargs["passphrase"] = password
        elif password:
            connect_kwargs["password"] = password

        if not password and not key_file:
            connect_kwargs["allow_agent"] = True
            connect_kwargs["look_for_keys"] = True

        print(f"  Connecting to {username}@{hostname}:{port}...")
        client.connect(**connect_kwargs)
        print(f"  Connected!")

        sftp = client.open_sftp()

        _, stdout, _ = client.exec_command("echo $HOME")
        home_dir = stdout.read().decode().strip()

        ssh_state["client"] = client
        ssh_state["sftp"] = sftp
        ssh_state["home_dir"] = home_dir
        ssh_state["host"] = config_host or hostname

        return jsonify(
            {
                "status": "connected",
                "home_dir": home_dir,
                "host": ssh_state["host"],
                "username": username,
            }
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/disconnect", methods=["POST"])
def disconnect():
    cleanup_connection()
    return jsonify({"status": "disconnected"})


@app.route("/api/ls", methods=["POST"])
def list_directory():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    path = request.json.get("path", ssh_state["home_dir"])
    path = posixpath.normpath(path)

    try:
        entries = []
        for attr in ssh_state["sftp"].listdir_attr(path):
            entry_mode = attr.st_mode
            is_dir = stat.S_ISDIR(entry_mode) if entry_mode else False
            is_link = stat.S_ISLNK(entry_mode) if entry_mode else False

            # For symlinks, check if target is a directory
            if is_link:
                try:
                    target_path = posixpath.join(path, attr.filename)
                    target_stat = ssh_state["sftp"].stat(target_path)
                    is_dir = stat.S_ISDIR(target_stat.st_mode)
                except Exception:
                    pass

            entries.append(
                {
                    "name": attr.filename,
                    "is_dir": is_dir,
                    "is_link": is_link,
                    "size": attr.st_size if attr.st_size else 0,
                    "mode": stat.filemode(entry_mode) if entry_mode else "?---------",
                    "mtime": attr.st_mtime if attr.st_mtime else 0,
                }
            )

        entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))

        return jsonify({"path": path, "entries": entries})
    except PermissionError:
        return jsonify({"error": f"Permission denied: {path}"}), 403
    except FileNotFoundError:
        return jsonify({"error": f"Not found: {path}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/chmod", methods=["POST"])
def chmod_entry():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    path = data.get("path", "")
    mode = data.get("mode", 0)

    if not path:
        return jsonify({"error": "path is required"}), 400

    try:
        ssh_state["sftp"].chmod(path, mode)
        # Return updated stat
        new_stat = ssh_state["sftp"].stat(path)
        new_mode = stat.filemode(new_stat.st_mode) if new_stat.st_mode else "?---------"
        return jsonify({"status": "ok", "mode": new_mode})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/move", methods=["POST"])
def move_entry():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    src = data.get("src", "")
    dest = data.get("dest", "")

    if not src or not dest:
        return jsonify({"error": "src and dest are required"}), 400

    try:
        ssh_state["sftp"].rename(src, dest)
        return jsonify({"status": "ok"})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except FileNotFoundError:
        return jsonify({"error": f"Not found: {src}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/preview", methods=["POST"])
def preview_file():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    path = request.json.get("path", "")
    if not path:
        return jsonify({"error": "path is required"}), 400

    max_bytes = 64 * 1024  # 64KB

    try:
        file_stat = ssh_state["sftp"].stat(path)
        file_size = file_stat.st_size if file_stat.st_size else 0

        with ssh_state["sftp"].open(path, "r") as f:
            raw = f.read(max_bytes)

        truncated = file_size > max_bytes

        # Detect binary: check for null bytes in the first 8KB
        check_chunk = raw[:8192]
        if b"\x00" in check_chunk:
            return jsonify({"binary": True, "size": file_size})

        content = raw.decode("utf-8", errors="replace")
        return jsonify({
            "content": content,
            "truncated": truncated,
            "size": file_size,
        })
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except FileNotFoundError:
        return jsonify({"error": f"Not found: {path}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── Terminal WebSocket ──────────────────────────────────────────────


@socketio.on("connect")
def handle_connect():
    pass


@socketio.on("disconnect")
def handle_disconnect():
    pass


@socketio.on("terminal_start")
def handle_terminal_start(data):
    if not ssh_state["client"]:
        emit("terminal_output", {"data": "\r\nNot connected to SSH server.\r\n"})
        return

    sid = request.sid

    try:
        channel = ssh_state["client"].invoke_shell(
            term="xterm-256color",
            width=data.get("cols", 80),
            height=data.get("rows", 24),
        )
        ssh_state["channel"] = channel

        def read_output():
            try:
                while not channel.closed:
                    if channel.recv_ready():
                        output = channel.recv(4096)
                        if output:
                            socketio.emit(
                                "terminal_output",
                                {"data": output.decode("utf-8", errors="replace")},
                                to=sid,
                            )
                        else:
                            break
                    else:
                        time.sleep(0.01)
            except Exception as e:
                socketio.emit(
                    "terminal_output",
                    {"data": f"\r\nConnection lost: {e}\r\n"},
                    to=sid,
                )

        thread = threading.Thread(target=read_output, daemon=True)
        thread.start()
    except Exception as e:
        emit("terminal_output", {"data": f"\r\nFailed to start terminal: {e}\r\n"})


@socketio.on("terminal_input")
def handle_terminal_input(data):
    channel = ssh_state.get("channel")
    if channel and not channel.closed:
        try:
            channel.send(data["data"])
        except Exception:
            pass


@socketio.on("terminal_resize")
def handle_terminal_resize(data):
    channel = ssh_state.get("channel")
    if channel and not channel.closed:
        try:
            channel.resize_pty(
                width=data.get("cols", 80),
                height=data.get("rows", 24),
            )
        except Exception:
            pass


if __name__ == "__main__":
    port = 8022
    print(f"\n  Open in your browser: http://localhost:{port}\n")
    socketio.run(
        app, debug=True, host="127.0.0.1", port=port, allow_unsafe_werkzeug=True
    )
