import re
import shlex

from flask import Blueprint, jsonify

from .connections import USER_BIN_PATH, body, with_connection

bp = Blueprint("tmux", __name__)

PANE_ID = re.compile(r"^%\d+$")
SECTION = "---"
# tmux replaces tab characters in its output under a non-UTF-8 locale, so the
# separator is printable and the free-text field comes last.
FIELD = "|"
WINDOW_FORMAT = FIELD.join(
    ["#{window_index}", "#{window_active}", "#{window_panes}", "#{window_name}"]
)
PANE_FORMAT = FIELD.join(
    [
        "#{pane_id}",
        "#{pane_index}",
        "#{pane_left}",
        "#{pane_top}",
        "#{pane_width}",
        "#{pane_height}",
        "#{pane_active}",
        "#{pane_current_command}",
    ]
)
STATE_SCRIPT = (
    USER_BIN_PATH + "tmux list-sessions -F '#{session_name}' 2>/dev/null | head -n 1; "
    f"echo {SECTION}; tmux list-windows -F '{WINDOW_FORMAT}' 2>/dev/null; "
    f"echo {SECTION}; tmux list-panes -F '{PANE_FORMAT}' 2>/dev/null"
)


def parse_state(output):
    sections = [part.strip("\n") for part in output.split(SECTION + "\n")]
    sections += [""] * (3 - len(sections))
    session = sections[0].strip()

    windows = []
    for line in sections[1].splitlines():
        parts = line.split(FIELD, 3)
        if len(parts) == 4:
            windows.append(
                {
                    "index": int(parts[0]),
                    "active": parts[1] == "1",
                    "pane_count": int(parts[2]),
                    "name": parts[3],
                }
            )

    panes = []
    for line in sections[2].splitlines():
        parts = line.split(FIELD, 7)
        if len(parts) == 8:
            panes.append(
                {
                    "id": parts[0],
                    "index": int(parts[1]),
                    "left": int(parts[2]),
                    "top": int(parts[3]),
                    "width": int(parts[4]),
                    "height": int(parts[5]),
                    "active": parts[6] == "1",
                    "command": parts[7],
                }
            )

    return {
        "active": bool(session),
        "session": session or None,
        "windows": windows,
        "panes": panes,
    }


@bp.get("/api/tmux/state")
@with_connection
def tmux_state(conn):
    """Session, windows, and panes of the active window, from one remote command."""
    try:
        output = conn.run(STATE_SCRIPT, timeout=10).out
    except TimeoutError:
        output = ""
    return jsonify(parse_state(output))


def _tmux(conn, *args):
    command = USER_BIN_PATH + "tmux " + " ".join(shlex.quote(str(a)) for a in args)
    result = conn.run(command, timeout=10)
    if not result.ok:
        return jsonify({"error": result.err.strip() or "tmux command failed"}), 400
    return jsonify({"status": "ok"})


def _window_target():
    return f":{int(body().get('index', 0))}"


def _pane_target():
    pane_id = body().get("pane_id") or ""
    if not PANE_ID.match(pane_id):
        raise ValueError("pane_id required")
    return pane_id


@bp.post("/api/tmux/new-window")
@with_connection
def tmux_new_window(conn):
    return _tmux(conn, "new-window")


@bp.post("/api/tmux/select-window")
@with_connection
def tmux_select_window(conn):
    return _tmux(conn, "select-window", "-t", _window_target())


@bp.post("/api/tmux/rename-window")
@with_connection
def tmux_rename_window(conn):
    return _tmux(conn, "rename-window", "-t", _window_target(), body().get("name") or "")


@bp.post("/api/tmux/kill-window")
@with_connection
def tmux_kill_window(conn):
    return _tmux(conn, "kill-window", "-t", _window_target())


@bp.post("/api/tmux/split-pane")
@with_connection
def tmux_split_pane(conn):
    flag = "-h" if body().get("direction", "h") == "h" else "-v"
    return _tmux(conn, "split-window", flag)


@bp.post("/api/tmux/select-pane")
@with_connection
def tmux_select_pane(conn):
    return _tmux(conn, "select-pane", "-t", _pane_target())


@bp.post("/api/tmux/kill-pane")
@with_connection
def tmux_kill_pane(conn):
    return _tmux(conn, "kill-pane", "-t", _pane_target())
