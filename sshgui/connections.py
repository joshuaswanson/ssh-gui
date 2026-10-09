import base64
import getpass
import hashlib
import os
import shlex
import socket
import threading
import time
import uuid
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import NamedTuple

import paramiko
from flask import jsonify, request

SSH_DIR = Path.home() / ".ssh"
SSH_CONFIG_PATH = SSH_DIR / "config"
KNOWN_HOSTS_PATH = SSH_DIR / "known_hosts"
LOCAL_USER = getpass.getuser()
CONNECT_TIMEOUT = 30
KEEPALIVE_SECONDS = 30

# Non-interactive shells often skip the profile lines that add these to PATH.
USER_BIN_PATH = 'PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH:/opt/homebrew/bin:/usr/local/bin"; '

# `t SECONDS cmd...` stops cmd after SECONDS. macOS and BSD hosts have no
# coreutils timeout, so the fallback kills cmd from a background watcher.
TIMEOUT_FN = (
    't() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; return; fi; '
    's=$1; shift; "$@" & p=$!; '
    '( sleep "$s"; kill "$p" ) >/dev/null 2>&1 & w=$!; '
    'wait "$p"; r=$?; kill "$w" >/dev/null 2>&1; return $r; }; '
)

_connections = {}
_lock = threading.Lock()


class CommandResult(NamedTuple):
    code: int
    out: str
    err: str

    @property
    def ok(self):
        return self.code == 0


class SerializedSFTP:
    """One SFTP session shared by every request thread of a connection.

    paramiko's SFTPClient lets any thread consume another thread's response,
    which leaves the second thread waiting forever, so calls run one at a time.
    """

    def __init__(self, sftp):
        self._sftp = sftp
        self._lock = threading.RLock()

    def __getattr__(self, name):
        attr = getattr(self._sftp, name)
        if not callable(attr):
            return attr

        def locked(*args, **kwargs):
            with self._lock:
                return attr(*args, **kwargs)

        return locked

    @contextmanager
    def open(self, path, mode="r"):
        with self._lock, self._sftp.open(path, mode) as f:
            yield f


class Connection:
    def __init__(self, client, host, username, jump_client=None, proxy=None):
        self.id = str(uuid.uuid4())
        self.client = client
        self.sftp = SerializedSFTP(client.open_sftp())
        self.host = host
        self.username = username
        self.home_dir = self.sftp.normalize(".")
        self._jump_client = jump_client
        self._proxy = proxy
        self._user_names = {}

    @property
    def alive(self):
        transport = self.client.get_transport()
        return transport is not None and transport.is_active()

    def run(self, script, timeout=30):
        """Run a POSIX sh script on the remote host."""
        channel = self.client.get_transport().open_session(timeout=10)
        try:
            channel.exec_command("sh -c " + shlex.quote(script))
            channel.shutdown_write()

            err_chunks = []

            def drain_stderr():
                try:
                    while chunk := channel.recv_stderr(65536):
                        err_chunks.append(chunk)
                except (socket.timeout, OSError):
                    pass

            stderr_reader = threading.Thread(target=drain_stderr, daemon=True)
            stderr_reader.start()

            out_chunks = []
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"Command timed out after {timeout}s")
                channel.settimeout(remaining)
                try:
                    chunk = channel.recv(65536)
                except socket.timeout:
                    raise TimeoutError(f"Command timed out after {timeout}s") from None
                if not chunk:
                    break
                out_chunks.append(chunk)

            stderr_reader.join(timeout=5)
            code = channel.recv_exit_status()
            return CommandResult(
                code,
                b"".join(out_chunks).decode("utf-8", errors="replace"),
                b"".join(err_chunks).decode("utf-8", errors="replace"),
            )
        finally:
            channel.close()

    @contextmanager
    def dedicated_sftp(self):
        """A separate SFTP channel, so a long transfer does not block browsing."""
        sftp = self.client.open_sftp()
        try:
            yield sftp
        finally:
            sftp.close()

    def user_names(self, uids):
        """Map numeric uids to user names, asking the host only for new ones."""
        unknown = [u for u in uids if u not in self._user_names]
        if unknown:
            ids = " ".join(str(int(u)) for u in unknown)
            script = f'for u in {ids}; do echo "$u $(id -nu "$u" 2>/dev/null)"; done'
            try:
                lines = self.run(script, timeout=10).out.splitlines()
            except (TimeoutError, OSError, paramiko.SSHException):
                lines = []
            for line in lines:
                uid, _, name = line.partition(" ")
                if uid.isdigit():
                    self._user_names[int(uid)] = name.strip() or uid
        return {u: self._user_names.get(u, str(u)) for u in uids}

    def close(self):
        for resource in (self.sftp, self.client, self._jump_client, self._proxy):
            if resource is None:
                continue
            try:
                resource.close()
            except Exception:
                pass


def load_ssh_config():
    if SSH_CONFIG_PATH.exists():
        return paramiko.SSHConfig.from_path(str(SSH_CONFIG_PATH))
    return paramiko.SSHConfig()


def key_fingerprint(key):
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


class UnknownHostKey(Exception):
    def __init__(self, hostname, key):
        super().__init__(f"Unknown host key for {hostname}")
        self.hostname = hostname
        self.key_type = key.get_name()
        self.fingerprint = key_fingerprint(key)


class ConfirmedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """Accept an unknown host key only when the user has confirmed its fingerprint."""

    def __init__(self, trusted_fingerprint):
        self.trusted_fingerprint = trusted_fingerprint

    def missing_host_key(self, client, hostname, key):
        if key_fingerprint(key) != self.trusted_fingerprint:
            raise UnknownHostKey(hostname, key)
        SSH_DIR.mkdir(mode=0o700, exist_ok=True)
        existing = KNOWN_HOSTS_PATH.read_bytes() if KNOWN_HOSTS_PATH.exists() else b""
        separator = "" if not existing or existing.endswith(b"\n") else "\n"
        with open(KNOWN_HOSTS_PATH, "a") as f:
            f.write(f"{separator}{hostname} {key.get_name()} {key.get_base64()}\n")
        os.chmod(KNOWN_HOSTS_PATH, 0o600)


def _new_client(trusted_fingerprint):
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(ConfirmedHostKeyPolicy(trusted_fingerprint))
    return client


def _existing_keys(paths):
    expanded = (os.path.expanduser(p) for p in paths if p)
    return [p for p in expanded if os.path.exists(p)]


def _parse_proxy_jump(spec, config):
    if "," in spec:
        raise ValueError("ProxyJump with more than one hop is not supported")
    user, _, host_port = spec.strip().rpartition("@")
    host, _, port = host_port.partition(":")
    info = config.lookup(host)
    return {
        "hostname": info.get("hostname", host),
        "port": int(port or info.get("port", 22)),
        "username": user or info.get("user") or LOCAL_USER,
        "key_files": _existing_keys(info.get("identityfile", [])),
    }


def open_connection(data):
    hostname = (data.get("hostname") or "").strip()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    port = int(data.get("port") or 22)
    key_files = [data["key_file"]] if data.get("key_file") else []
    config_host = (data.get("config_host") or "").strip()
    trusted_fingerprint = data.get("trusted_fingerprint") or ""

    jump = None
    proxy_command = None
    if config_host:
        config = load_ssh_config()
        info = config.lookup(config_host)
        hostname = info.get("hostname", config_host)
        username = username or info.get("user", "")
        port = int(info.get("port", port))
        key_files = info.get("identityfile") or key_files
        proxy_jump = info.get("proxyjump", "")
        if proxy_jump and proxy_jump.lower() != "none":
            jump = _parse_proxy_jump(proxy_jump, config)
        elif info.get("proxycommand"):
            proxy_command = info["proxycommand"]

    if not hostname:
        raise ValueError("Hostname is required")
    username = username or LOCAL_USER

    jump_client = None
    proxy = None
    client = None
    try:
        sock = None
        if jump:
            jump_client = _new_client(trusted_fingerprint)
            jump_kwargs = {
                "hostname": jump["hostname"],
                "port": jump["port"],
                "username": jump["username"],
                "timeout": CONNECT_TIMEOUT,
            }
            if jump["key_files"]:
                jump_kwargs["key_filename"] = jump["key_files"]
            jump_client.connect(**jump_kwargs)
            sock = jump_client.get_transport().open_channel(
                "direct-tcpip",
                (hostname, port),
                ("127.0.0.1", 0),
                timeout=CONNECT_TIMEOUT,
            )
        elif proxy_command:
            proxy = sock = paramiko.ProxyCommand(proxy_command)

        client = _new_client(trusted_fingerprint)
        kwargs = {
            "hostname": hostname,
            "port": port,
            "username": username,
            "timeout": CONNECT_TIMEOUT,
        }
        if sock is not None:
            kwargs["sock"] = sock
        existing_keys = _existing_keys(key_files)
        if existing_keys:
            kwargs["key_filename"] = existing_keys
            if password:
                kwargs["passphrase"] = password
        elif password:
            kwargs["password"] = password

        client.connect(**kwargs)
        client.get_transport().set_keepalive(KEEPALIVE_SECONDS)
        conn = Connection(
            client,
            host=config_host or hostname,
            username=username,
            jump_client=jump_client,
            proxy=proxy,
        )
    except BaseException:
        for resource in (client, jump_client, proxy):
            if resource is not None:
                try:
                    resource.close()
                except Exception:
                    pass
        raise

    with _lock:
        _connections[conn.id] = conn
    return conn


def get_connection(conn_id):
    """Return the live connection with this id, dropping it if the link died."""
    with _lock:
        conn = _connections.get(conn_id)
        if conn is not None and not conn.alive:
            del _connections[conn_id]
            dead, conn = conn, None
        else:
            dead = None
    if dead is not None:
        dead.close()
    return conn


def close_connection(conn_id):
    with _lock:
        conn = _connections.pop(conn_id, None)
    if conn is not None:
        conn.close()


def close_all_connections():
    with _lock:
        conns = list(_connections.values())
        _connections.clear()
    for conn in conns:
        conn.close()


def request_connection_id():
    return request.headers.get("X-Connection-Id") or request.values.get("connection_id")


def with_connection(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        conn = get_connection(request_connection_id())
        if conn is None:
            return jsonify({"error": "Not connected"}), 400
        return view(conn, *args, **kwargs)

    return wrapper


def body():
    return request.get_json(silent=True) or {}
