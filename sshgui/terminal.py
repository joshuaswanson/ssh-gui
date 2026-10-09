import codecs
import shlex
import threading

from flask import request
from flask_socketio import emit

from . import socketio
from .connections import USER_BIN_PATH, get_connection

TERM = "xterm-256color"

_channels = {}
_lock = threading.Lock()


def _dimensions(data):
    cols = max(2, min(1000, int(data.get("cols") or 80)))
    rows = max(2, min(1000, int(data.get("rows") or 24)))
    return cols, rows


def _open_channel(conn, data):
    cols, rows = _dimensions(data)
    session = data.get("tmux_session")
    if not session:
        return conn.client.invoke_shell(term=TERM, width=cols, height=rows)

    command = f"{USER_BIN_PATH}exec tmux attach -t {shlex.quote(session)}"
    if data.get("tmux_window") is not None:
        command += f" \\; select-window -t {int(data['tmux_window'])}"
    channel = conn.client.get_transport().open_session(timeout=10)
    channel.get_pty(term=TERM, width=cols, height=rows)
    channel.exec_command("sh -c " + shlex.quote(command))
    return channel


def _replace_channel(sid, channel):
    with _lock:
        previous = _channels.pop(sid, None)
        if channel is not None:
            _channels[sid] = channel
    if previous is not None:
        previous.close()


def _pump_output(sid, channel):
    # A multibyte character can be split across two reads.
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    try:
        while data := channel.recv(32768):
            text = decoder.decode(data)
            if text:
                socketio.emit("terminal_output", {"data": text}, to=sid)
    except OSError:
        pass
    finally:
        with _lock:
            still_current = _channels.get(sid) is channel
            if still_current:
                del _channels[sid]
        channel.close()
        if still_current:
            socketio.emit("terminal_closed", {}, to=sid)


@socketio.on("terminal_start")
@socketio.on("terminal_switch")
def handle_terminal_open(data):
    """Attach this socket to a new shell, or to a tmux session when one is named."""
    conn = get_connection(data.get("connection_id"))
    if conn is None:
        emit("terminal_output", {"data": "\r\nNot connected to SSH server.\r\n"})
        return
    try:
        channel = _open_channel(conn, data)
    except Exception as e:
        emit("terminal_output", {"data": f"\r\nFailed to start terminal: {e}\r\n"})
        return
    channel.settimeout(None)
    _replace_channel(request.sid, channel)
    threading.Thread(target=_pump_output, args=(request.sid, channel), daemon=True).start()


@socketio.on("terminal_input")
def handle_terminal_input(data):
    channel = _channels.get(request.sid)
    if channel is None:
        return
    try:
        channel.sendall(data["data"])
    except OSError:
        pass


@socketio.on("terminal_resize")
def handle_terminal_resize(data):
    channel = _channels.get(request.sid)
    if channel is None:
        return
    cols, rows = _dimensions(data)
    try:
        channel.resize_pty(width=cols, height=rows)
    except Exception:
        pass


@socketio.on("disconnect")
def handle_disconnect(*_):
    _replace_channel(request.sid, None)
