import re
import subprocess

import paramiko
from flask import Blueprint, jsonify, request

from .connections import (
    LOCAL_USER,
    SSH_CONFIG_PATH,
    SSH_DIR,
    body,
    close_connection,
    load_ssh_config,
    open_connection,
    request_connection_id,
)

bp = Blueprint("hosts", __name__)

CONFIG_TOKEN = re.compile(r"^[^\s#]+$")
KEY_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]*$")
KEY_TYPES = {"ed25519", "rsa", "ecdsa"}
NON_KEY_FILES = {"config", "known_hosts", "known_hosts.old", "authorized_keys", "environment"}


@bp.get("/api/ssh-configs")
def get_ssh_configs():
    config = load_ssh_config()
    hosts = []
    for name in config.get_hostnames():
        if "*" in name or "?" in name:
            continue
        info = config.lookup(name)
        identity_files = info.get("identityfile") or [""]
        hosts.append(
            {
                "name": name,
                "hostname": info.get("hostname", name),
                "user": info.get("user", LOCAL_USER),
                "port": int(info.get("port", 22)),
                "identity_file": identity_files[0],
            }
        )
    hosts.sort(key=lambda h: h["name"])
    return jsonify({"hosts": hosts, "default_user": LOCAL_USER})


@bp.post("/api/save-host")
def save_host():
    data = body()
    alias = (data.get("alias") or "").strip()
    hostname = (data.get("hostname") or "").strip()
    username = (data.get("username") or "").strip()
    key_file = (data.get("key_file") or "").strip()
    port = int(data.get("port") or 22)

    if not alias or not hostname:
        return jsonify({"error": "Name and hostname are required"}), 400
    for label, value in (("Name", alias), ("Host", hostname), ("Username", username)):
        if value and not CONFIG_TOKEN.match(value):
            return jsonify({"error": f"{label} cannot contain spaces or #"}), 400
    if "\n" in key_file or "\r" in key_file:
        return jsonify({"error": "Invalid identity file"}), 400
    if alias in load_ssh_config().get_hostnames():
        return jsonify({"error": f"Host '{alias}' already exists"}), 400

    lines = ["", f"Host {alias}", f"    HostName {hostname}"]
    if username:
        lines.append(f"    User {username}")
    if port != 22:
        lines.append(f"    Port {port}")
    if key_file:
        lines.append(f'    IdentityFile "{key_file}"' if " " in key_file else f"    IdentityFile {key_file}")

    SSH_DIR.mkdir(mode=0o700, exist_ok=True)
    with open(SSH_CONFIG_PATH, "a") as f:
        f.write("\n".join(lines) + "\n")
    return jsonify({"status": "ok"})


@bp.post("/api/connect")
def connect():
    try:
        conn = open_connection(body())
    except paramiko.PasswordRequiredException:
        message = "The private key is encrypted. Enter its passphrase in the Password field."
    except paramiko.BadHostKeyException as e:
        message = f"Host key for {e.hostname} does not match known_hosts. Connection refused."
    except paramiko.AuthenticationException:
        message = "Authentication failed. Check the username, key, or password."
    except Exception as e:
        message = str(e) or type(e).__name__
    else:
        return jsonify(
            {
                "status": "connected",
                "connection_id": conn.id,
                "home_dir": conn.home_dir,
                "host": conn.host,
                "username": conn.username,
            }
        )
    return jsonify({"status": "error", "message": message}), 400


@bp.post("/api/disconnect")
def disconnect():
    close_connection(request_connection_id())
    return jsonify({"status": "disconnected"})


def _looks_like_private_key(path):
    try:
        with open(path, "rb") as f:
            return b"-----BEGIN" in f.read(40)
    except OSError:
        return False


def _fingerprint(path):
    try:
        result = subprocess.run(
            ["ssh-keygen", "-lf", str(path)], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.TimeoutExpired):
        return "", ""
    parts = result.stdout.split()
    if result.returncode != 0 or len(parts) < 2:
        return "", ""
    key_type = parts[-1].strip("()") if len(parts) >= 4 else ""
    return parts[1], key_type


@bp.get("/api/ssh-keys")
def list_ssh_keys():
    if not SSH_DIR.exists():
        return jsonify({"keys": []})

    keys = []
    for path in sorted(SSH_DIR.iterdir()):
        if path.is_dir() or path.name.startswith(".") or path.name in NON_KEY_FILES:
            continue
        if path.suffix == ".pub" or not _looks_like_private_key(path):
            continue
        fingerprint, key_type = _fingerprint(path)
        keys.append(
            {
                "name": path.name,
                "path": str(path),
                "has_pub": (SSH_DIR / (path.name + ".pub")).exists(),
                "fingerprint": fingerprint,
                "type": key_type,
            }
        )
    return jsonify({"keys": keys})


@bp.get("/api/ssh-keys/public")
def get_public_key():
    name = request.args.get("name", "")
    if not KEY_NAME.match(name):
        return jsonify({"error": "Invalid key name"}), 400
    pub_path = SSH_DIR / (name + ".pub")
    if not pub_path.exists():
        return jsonify({"error": "Public key not found"}), 404
    return jsonify({"content": pub_path.read_text().strip()})


@bp.post("/api/ssh-keys/generate")
def generate_ssh_key():
    data = body()
    name = (data.get("name") or "id_ed25519").strip()
    key_type = data.get("type") or "ed25519"
    passphrase = data.get("passphrase") or ""
    comment = data.get("comment") or ""

    if not KEY_NAME.match(name):
        return jsonify({"error": "Key name may contain only letters, digits, . _ -"}), 400
    if key_type not in KEY_TYPES:
        return jsonify({"error": f"Unsupported key type '{key_type}'"}), 400

    key_path = SSH_DIR / name
    if key_path.exists():
        return jsonify({"error": f"Key '{name}' already exists"}), 400

    SSH_DIR.mkdir(mode=0o700, exist_ok=True)
    cmd = ["ssh-keygen", "-t", key_type, "-f", str(key_path), "-N", passphrase]
    if comment:
        cmd.extend(["-C", comment])
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return jsonify({"error": result.stderr.strip() or "ssh-keygen failed"}), 400

    public_key = (SSH_DIR / (name + ".pub")).read_text().strip()
    return jsonify({"status": "ok", "public_key": public_key})
