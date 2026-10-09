import json
import shlex

from flask import Blueprint, jsonify

from .connections import USER_BIN_PATH, body, with_connection

bp = Blueprint("packages", __name__)

DETECT_SCRIPT = USER_BIN_PATH + """
echo "uv=$(command -v uv 2>/dev/null)"
echo "pip=$(command -v pip 2>/dev/null || command -v pip3 2>/dev/null)"
echo "python=$(python3 --version 2>/dev/null || python --version 2>/dev/null)"
echo "active=$VIRTUAL_ENV"
for d in "$HOME/.venv" "$HOME/venv" "$HOME"/*/.venv "$HOME"/*/venv; do
  if [ -d "$d" ]; then echo "venv=$d"; fi
done
"""
INSTALL_SECONDS = 600


def _has_uv(conn):
    return conn.run(USER_BIN_PATH + "command -v uv >/dev/null 2>&1", timeout=10).ok


def _pip(conn, venv_path, action, *args):
    """Build a pip command for the venv, or for the system Python without one."""
    quoted_args = " ".join(shlex.quote(a) for a in args)
    if _has_uv(conn):
        target = f"VIRTUAL_ENV={shlex.quote(venv_path)} " if venv_path else ""
        system = "" if venv_path else " --system"
        return f"{USER_BIN_PATH}{target}uv pip {action}{system} {quoted_args}"
    if action == "uninstall":
        quoted_args = "-y " + quoted_args
    if venv_path:
        return f"{shlex.quote(venv_path + '/bin/python')} -m pip {action} {quoted_args}"
    return (
        f"if command -v pip >/dev/null 2>&1; then pip {action} {quoted_args}; "
        f"else pip3 {action} {quoted_args}; fi"
    )


def _requested_packages():
    packages = (body().get("package") or "").split()
    if not packages:
        raise ValueError("Package name is required")
    return packages


def _run_pip(conn, action, *args):
    result = conn.run(_pip(conn, body().get("venv_path"), action, *args), timeout=INSTALL_SECONDS)
    output = (result.out + result.err).strip()
    if not result.ok:
        return jsonify({"error": output or f"pip {action} failed"}), 400
    return jsonify({"status": "ok", "output": output})


@bp.get("/api/packages/detect")
@with_connection
def packages_detect(conn):
    info = {"uv": "", "pip": "", "python": "", "active": ""}
    venvs = []
    for line in conn.run(DETECT_SCRIPT, timeout=15).out.splitlines():
        key, _, value = line.partition("=")
        if key == "venv":
            venvs.append(value)
        elif key in info:
            info[key] = value.strip()
    return jsonify(
        {
            "has_uv": bool(info["uv"]),
            "has_pip": bool(info["pip"]),
            "python_version": info["python"] or None,
            "active_venv": info["active"] or None,
            "nearby_venvs": venvs,
        }
    )


@bp.post("/api/packages/list")
@with_connection
def packages_list(conn):
    result = conn.run(_pip(conn, body().get("venv_path"), "list", "--format=json"), timeout=60)
    if not result.ok:
        return jsonify({"packages": [], "error": result.err.strip() or "pip list failed"})
    try:
        return jsonify({"packages": json.loads(result.out)})
    except json.JSONDecodeError:
        return jsonify({"packages": [], "error": "Failed to parse package list"})


@bp.post("/api/packages/install")
@with_connection
def packages_install(conn):
    return _run_pip(conn, "install", *_requested_packages())


@bp.post("/api/packages/uninstall")
@with_connection
def packages_uninstall(conn):
    return _run_pip(conn, "uninstall", *_requested_packages())


@bp.post("/api/packages/create-venv")
@with_connection
def packages_create_venv(conn):
    path = (body().get("path") or "").strip()
    if not path:
        return jsonify({"error": "Path is required"}), 400
    quoted = shlex.quote(path)
    if _has_uv(conn):
        script = f"{USER_BIN_PATH}uv venv {quoted}"
    else:
        script = f"python3 -m venv {quoted} || python -m venv {quoted}"
    result = conn.run(script, timeout=120)
    if not result.ok:
        return jsonify({"error": (result.out + result.err).strip() or "venv creation failed"}), 400
    return jsonify({"status": "ok", "output": (result.out + result.err).strip()})
