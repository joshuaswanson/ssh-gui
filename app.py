import json
import os
import stat
import time
import posixpath
import threading
import shlex
import base64
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


@app.route("/api/save-host", methods=["POST"])
def save_host():
    data = request.json
    alias = data.get("alias", "").strip()
    hostname = data.get("hostname", "").strip()
    username = data.get("username", "").strip()
    port = int(data.get("port", 22))
    key_file = data.get("key_file", "").strip()

    if not alias or not hostname:
        return jsonify({"error": "Name and hostname are required"}), 400

    config_path = Path.home() / ".ssh" / "config"
    config_path.parent.mkdir(mode=0o700, exist_ok=True)

    # Check if alias already exists
    if config_path.exists():
        config = paramiko.SSHConfig()
        with open(config_path) as f:
            config.parse(f)
        if alias in config.get_hostnames():
            return jsonify({"error": f"Host '{alias}' already exists"}), 400

    # Append new host entry
    lines = ["\n", f"Host {alias}\n", f"    HostName {hostname}\n"]
    if username:
        lines.append(f"    User {username}\n")
    if port != 22:
        lines.append(f"    Port {port}\n")
    if key_file:
        lines.append(f"    IdentityFile {key_file}\n")

    with open(config_path, "a") as f:
        f.writelines(lines)

    return jsonify({"status": "ok"})


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


@app.route("/api/dir-sizes", methods=["POST"])
def get_dir_sizes():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    path = data.get("path", "")
    names = data.get("names", [])

    if not path or not names:
        return jsonify({"sizes": {}})

    try:
        # Run du -sb on each directory individually so permission errors
        # or slow dirs don't block the rest. Use -s (summarize) and a
        # per-directory timeout so one slow tree doesn't kill everything.
        script_parts = []
        for n in names:
            quoted = shlex.quote(posixpath.join(path, n))
            # Try du -sb first (GNU), fall back to du -sk (BSD/macOS)
            script_parts.append(
                f"timeout 5 du -sb {quoted} 2>/dev/null || "
                f"timeout 5 du -sk {quoted} 2>/dev/null || "
                f"echo '0\t'{quoted}"
            )
        cmd = "; ".join(script_parts) + "; exit 0"

        _, stdout, _ = ssh_state["client"].exec_command(cmd)
        output = stdout.read().decode()

        sizes = {}
        for line in output.strip().split("\n"):
            if "\t" in line:
                size_str, dir_path = line.split("\t", 1)
                try:
                    name = posixpath.basename(dir_path.rstrip("/"))
                    val = int(size_str)
                    # Skip 0 values -- they come from the fallback when du fails
                    if val > 0 and name not in sizes:
                        sizes[name] = val
                except ValueError:
                    pass

        return jsonify({"sizes": sizes})
    except Exception:
        return jsonify({"sizes": {}})


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


@app.route("/api/delete", methods=["POST"])
def delete_entry():
    if not ssh_state["sftp"] or not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    path = data.get("path", "")
    is_dir = data.get("is_dir", False)

    if not path:
        return jsonify({"error": "path is required"}), 400

    try:
        if is_dir:
            # Use rm -rf via SSH for recursive directory deletion
            escaped = shlex.quote(path)
            _, stdout, stderr = ssh_state["client"].exec_command(
                "rm -rf " + escaped
            )
            err = stderr.read().decode().strip()
            if err:
                return jsonify({"error": err}), 400
        else:
            ssh_state["sftp"].remove(path)
        return jsonify({"status": "ok"})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except FileNotFoundError:
        return jsonify({"error": f"Not found: {path}"}), 404
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


@app.route("/api/mkdir", methods=["POST"])
def mkdir_entry():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    path = request.json.get("path", "")
    if not path:
        return jsonify({"error": "path is required"}), 400

    try:
        ssh_state["sftp"].mkdir(path)
        return jsonify({"status": "ok"})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    except IOError as e:
        return jsonify({"error": str(e)}), 400


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"}
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}


@app.route("/api/preview", methods=["POST"])
def preview_file():
    if not ssh_state["sftp"]:
        return jsonify({"error": "Not connected"}), 400

    path = request.json.get("path", "")
    if not path:
        return jsonify({"error": "path is required"}), 400

    try:
        file_stat = ssh_state["sftp"].stat(path)
        file_size = file_stat.st_size if file_stat.st_size else 0

        ext = posixpath.splitext(path)[1].lower()

        # Image preview
        if ext in IMAGE_EXTENSIONS:
            max_image = 5 * 1024 * 1024  # 5MB
            if file_size > max_image:
                return jsonify({"error": "Image too large to preview"})
            with ssh_state["sftp"].open(path, "rb") as f:
                raw = f.read(max_image)
            data = base64.b64encode(raw).decode("ascii")
            mime = IMAGE_MIME.get(ext, "application/octet-stream")
            return jsonify({"image": True, "data": data, "mime": mime, "size": file_size})

        # PDF preview
        if ext == ".pdf":
            max_pdf = 10 * 1024 * 1024  # 10MB
            if file_size > max_pdf:
                return jsonify({"error": "PDF too large to preview"})
            with ssh_state["sftp"].open(path, "rb") as f:
                raw = f.read(max_pdf)
            data = base64.b64encode(raw).decode("ascii")
            return jsonify({"pdf": True, "data": data, "size": file_size})

        # Text preview
        max_bytes = 64 * 1024  # 64KB
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


@app.route("/api/git-info", methods=["POST"])
def git_info():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    path = request.json.get("path", "")
    if not path:
        return jsonify({"error": "path is required"}), 400

    quoted = shlex.quote(path)

    result = {}

    # Determine the directory to cd into for git commands
    # If path is a directory, use it directly; otherwise use its parent
    dir_cmd = (
        f"if [ -d {quoted} ]; then echo {quoted}; "
        f"else echo $(dirname {quoted}); fi"
    )
    _, stdout, _ = ssh_state["client"].exec_command(dir_cmd)
    git_dir = stdout.read().decode().strip()
    git_dir_q = shlex.quote(git_dir)

    # Get the author of the commit that first added this file (skip for directories)
    basename = posixpath.basename(path)
    if basename and basename != ".":
        bn_q = shlex.quote(basename)
        cmd = (
            f"cd {git_dir_q} && "
            f"git log --diff-filter=A --follow --format='%an' -- {bn_q} 2>/dev/null | tail -1"
        )
        _, stdout, _ = ssh_state["client"].exec_command(cmd)
        author = stdout.read().decode().strip()
        if author:
            result["created_by"] = author

    # Get the current git branch
    cmd = f"cd {git_dir_q} && git rev-parse --abbrev-ref HEAD 2>/dev/null"
    _, stdout, _ = ssh_state["client"].exec_command(cmd)
    branch = stdout.read().decode().strip()
    if branch:
        result["branch"] = branch

    return jsonify(result)


# ── Tmux ───────────────────────────────────────────────────────────


def run_ssh_command(cmd):
    """Run a command on the remote server and return (stdout, stderr)."""
    if not ssh_state["client"]:
        return None, "Not connected"
    try:
        _, stdout, stderr = ssh_state["client"].exec_command(cmd)
        return stdout.read().decode().strip(), stderr.read().decode().strip()
    except Exception as e:
        return None, str(e)


@app.route("/api/tmux/status")
def tmux_status():
    if not ssh_state["client"]:
        return jsonify({"active": False, "session": None})

    # Check if any tmux server is running (not just our shell's session)
    out, _ = run_ssh_command("tmux list-sessions -F '#{session_name}' 2>/dev/null")
    if out:
        # Return the first session name
        first_session = out.split("\n")[0].strip()
        return jsonify({"active": True, "session": first_session})
    return jsonify({"active": False, "session": None})


@app.route("/api/tmux/windows")
def tmux_windows():
    if not ssh_state["client"]:
        return jsonify({"windows": []})

    out, _ = run_ssh_command(
        "tmux list-windows -F '#{window_index}|#{window_name}|#{window_active}|#{window_panes}' 2>/dev/null"
    )
    if not out:
        return jsonify({"windows": []})

    windows = []
    for line in out.split("\n"):
        parts = line.split("|")
        if len(parts) >= 4:
            windows.append({
                "index": int(parts[0]),
                "name": parts[1],
                "active": parts[2] == "1",
                "pane_count": int(parts[3]),
            })
    return jsonify({"windows": windows})


@app.route("/api/tmux/new-window", methods=["POST"])
def tmux_new_window():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    _, err = run_ssh_command("tmux new-window 2>/dev/null")
    if err and "no server" in err.lower():
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


@app.route("/api/tmux/select-window", methods=["POST"])
def tmux_select_window():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    index = data.get("index", 0)
    _, err = run_ssh_command(f"tmux select-window -t :{index} 2>/dev/null")
    if err and "no server" in err.lower():
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


@app.route("/api/tmux/rename-window", methods=["POST"])
def tmux_rename_window():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    index = data.get("index", 0)
    name = shlex.quote(data.get("name", ""))
    _, err = run_ssh_command(f"tmux rename-window -t :{index} {name} 2>/dev/null")
    if err and "no server" in err.lower():
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


@app.route("/api/tmux/kill-window", methods=["POST"])
def tmux_kill_window():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    index = data.get("index", 0)
    _, err = run_ssh_command(f"tmux kill-window -t :{index} 2>/dev/null")
    if err and "no server" in err.lower():
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


@app.route("/api/tmux/split-pane", methods=["POST"])
def tmux_split_pane():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    direction = data.get("direction", "h")
    flag = "-h" if direction == "h" else "-v"
    _, err = run_ssh_command(f"tmux split-window {flag} 2>/dev/null")
    if err and "no server" in err.lower():
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})


# ── Package Manager ────────────────────────────────────────────────


@app.route("/api/packages/detect")
def packages_detect():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    has_uv, _ = run_ssh_command("which uv 2>/dev/null")
    has_pip, _ = run_ssh_command("which pip 2>/dev/null || which pip3 2>/dev/null")
    python_ver, _ = run_ssh_command(
        "python3 --version 2>/dev/null || python --version 2>/dev/null"
    )
    active_venv, _ = run_ssh_command("echo $VIRTUAL_ENV")

    # Find nearby venvs in home dir
    nearby_venvs = []
    home = ssh_state.get("home_dir", "")
    if home:
        out, _ = run_ssh_command(
            f"ls -d {shlex.quote(home)}/.venv {shlex.quote(home)}/venv "
            f"{shlex.quote(home)}/*/venv {shlex.quote(home)}/*/.venv 2>/dev/null"
        )
        if out:
            nearby_venvs = [p for p in out.split("\n") if p.strip()]

    return jsonify({
        "has_uv": bool(has_uv),
        "has_pip": bool(has_pip),
        "python_version": python_ver or None,
        "active_venv": active_venv if active_venv else None,
        "nearby_venvs": nearby_venvs,
    })


@app.route("/api/packages/list", methods=["POST"])
def packages_list():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    venv_path = data.get("venv_path")

    # Build the pip command, preferring uv
    has_uv, _ = run_ssh_command("which uv 2>/dev/null")

    if venv_path:
        venv_quoted = shlex.quote(venv_path)
        if has_uv:
            cmd = f"VIRTUAL_ENV={venv_quoted} uv pip list --format=json 2>/dev/null"
        else:
            cmd = f"{venv_quoted}/bin/pip list --format=json 2>/dev/null"
    else:
        if has_uv:
            cmd = "uv pip list --format=json 2>/dev/null"
        else:
            cmd = "pip list --format=json 2>/dev/null || pip3 list --format=json 2>/dev/null"

    out, err = run_ssh_command(cmd)
    if out:
        try:
            packages = json.loads(out)
            return jsonify({"packages": packages})
        except json.JSONDecodeError:
            return jsonify({"packages": [], "error": "Failed to parse package list"})
    return jsonify({"packages": [], "error": err or "No output"})


@app.route("/api/packages/install", methods=["POST"])
def packages_install():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    package = data.get("package", "").strip()
    venv_path = data.get("venv_path")

    if not package:
        return jsonify({"error": "Package name is required"}), 400

    # Sanitize package name
    pkg_quoted = shlex.quote(package)
    has_uv, _ = run_ssh_command("which uv 2>/dev/null")

    if venv_path:
        venv_quoted = shlex.quote(venv_path)
        if has_uv:
            cmd = f"VIRTUAL_ENV={venv_quoted} uv pip install {pkg_quoted} 2>&1"
        else:
            cmd = f"{venv_quoted}/bin/pip install {pkg_quoted} 2>&1"
    else:
        if has_uv:
            cmd = f"uv pip install {pkg_quoted} 2>&1"
        else:
            cmd = f"pip install {pkg_quoted} 2>&1 || pip3 install {pkg_quoted} 2>&1"

    out, _ = run_ssh_command(cmd)
    if out and ("error" in out.lower() or "not found" in out.lower()):
        return jsonify({"error": out}), 400
    return jsonify({"status": "ok", "output": out})


@app.route("/api/packages/uninstall", methods=["POST"])
def packages_uninstall():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    package = data.get("package", "").strip()
    venv_path = data.get("venv_path")

    if not package:
        return jsonify({"error": "Package name is required"}), 400

    pkg_quoted = shlex.quote(package)
    has_uv, _ = run_ssh_command("which uv 2>/dev/null")

    if venv_path:
        venv_quoted = shlex.quote(venv_path)
        if has_uv:
            cmd = f"VIRTUAL_ENV={venv_quoted} uv pip uninstall {pkg_quoted} 2>&1"
        else:
            cmd = f"{venv_quoted}/bin/pip uninstall -y {pkg_quoted} 2>&1"
    else:
        if has_uv:
            cmd = f"uv pip uninstall {pkg_quoted} 2>&1"
        else:
            cmd = f"pip uninstall -y {pkg_quoted} 2>&1 || pip3 uninstall -y {pkg_quoted} 2>&1"

    out, _ = run_ssh_command(cmd)
    return jsonify({"status": "ok", "output": out})


@app.route("/api/packages/create-venv", methods=["POST"])
def packages_create_venv():
    if not ssh_state["client"]:
        return jsonify({"error": "Not connected"}), 400

    data = request.json
    path = data.get("path", "").strip()

    if not path:
        return jsonify({"error": "Path is required"}), 400

    path_quoted = shlex.quote(path)
    has_uv, _ = run_ssh_command("which uv 2>/dev/null")

    if has_uv:
        cmd = f"uv venv {path_quoted} 2>&1"
    else:
        cmd = f"python3 -m venv {path_quoted} 2>&1 || python -m venv {path_quoted} 2>&1"

    out, _ = run_ssh_command(cmd)
    if out and "error" in out.lower():
        return jsonify({"error": out}), 400
    return jsonify({"status": "ok", "output": out})


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
