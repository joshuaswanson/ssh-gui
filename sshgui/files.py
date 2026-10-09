import base64
import difflib
import posixpath
import shlex
import stat

from flask import Blueprint, Response, jsonify, request

from .connections import TIMEOUT_FN, body, with_connection

bp = Blueprint("files", __name__)

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
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_TEXT_BYTES = 64 * 1024
MAX_DIFF_BYTES = 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 256 * 1024
DU_SECONDS_PER_DIR = 5
DU_SECONDS_TOTAL = 30
SEARCH_SECONDS = 15
SEARCH_MAX_RESULTS = 200


def _required(data, key):
    value = data.get(key) or ""
    if not value:
        raise ValueError(f"{key} required")
    return value


def _mode_string(mode):
    return stat.filemode(mode) if mode else "?---------"


def _exists(conn, path):
    try:
        conn.sftp.lstat(path)
        return True
    except FileNotFoundError:
        return False


@bp.post("/api/ls")
@with_connection
def list_directory(conn):
    path = posixpath.normpath(body().get("path") or conn.home_dir)

    entries = []
    for attr in conn.sftp.listdir_attr(path):
        mode = attr.st_mode or 0
        is_link = stat.S_ISLNK(mode)
        is_dir = stat.S_ISDIR(mode)
        if is_link:
            try:
                target = conn.sftp.stat(posixpath.join(path, attr.filename))
                is_dir = stat.S_ISDIR(target.st_mode or 0)
            except OSError:
                pass
        entries.append(
            {
                "name": attr.filename,
                "is_dir": is_dir,
                "is_link": is_link,
                "size": attr.st_size or 0,
                "mode": _mode_string(mode),
                "mtime": attr.st_mtime or 0,
                "uid": attr.st_uid if attr.st_uid is not None else -1,
                "gid": attr.st_gid if attr.st_gid is not None else -1,
            }
        )
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))

    owners = conn.user_names({e["uid"] for e in entries if e["uid"] >= 0})
    for e in entries:
        e["owner"] = owners.get(e["uid"], str(e["uid"]))

    return jsonify(
        {"path": path, "entries": entries, "mtime": conn.sftp.stat(path).st_mtime or 0}
    )


@bp.post("/api/check-modified")
@with_connection
def check_modified(conn):
    """Report which directories have an mtime different from the one given."""
    changed = []
    for item in body().get("paths", []):
        path = item.get("path")
        if not path:
            continue
        try:
            mtime = conn.sftp.stat(path).st_mtime or 0
        except OSError:
            continue
        if mtime != item.get("mtime", 0):
            changed.append(path)
    return jsonify({"changed": changed})


@bp.post("/api/dir-sizes")
@with_connection
def get_dir_sizes(conn):
    data = body()
    path = data.get("path") or ""
    names = data.get("names") or []
    if not path or not names:
        return jsonify({"sizes": {}})

    # GNU du reports bytes with -b. BSD du only has -k.
    script = [
        TIMEOUT_FN,
        "if du -sb /dev/null >/dev/null 2>&1; then f=-sb; echo unit 1; "
        "else f=-sk; echo unit 1024; fi",
        "start=$(date +%s)",
        f"d() {{ [ $(( $(date +%s) - start )) -ge {DU_SECONDS_TOTAL} ] && return 0; "
        f'echo "$1 $(t {DU_SECONDS_PER_DIR} du $f -- "$2" 2>/dev/null | cut -f1)"; }}',
    ]
    for i, name in enumerate(names):
        script.append(f"d {i} {shlex.quote(posixpath.join(path, name))}")
    try:
        output = conn.run("\n".join(script), timeout=DU_SECONDS_TOTAL + 20).out
    except TimeoutError:
        return jsonify({"sizes": {}})

    unit = 1
    sizes = {}
    for line in output.splitlines():
        key, _, value = line.partition(" ")
        if not value.strip().isdigit():
            continue
        if key == "unit":
            unit = int(value)
        elif key.isdigit() and int(key) < len(names):
            sizes[names[int(key)]] = int(value) * unit
    return jsonify({"sizes": sizes})


@bp.post("/api/stat")
@with_connection
def stat_entry(conn):
    path = _required(body(), "path")
    s = conn.sftp.stat(path)
    mode = s.st_mode or 0
    uid = s.st_uid if s.st_uid is not None else -1
    gid = s.st_gid if s.st_gid is not None else -1

    owner, group = str(uid), str(gid)
    quoted = shlex.quote(path)
    names = conn.run(
        f"stat -c '%U:%G' -- {quoted} 2>/dev/null || stat -f '%Su:%Sg' -- {quoted} 2>/dev/null",
        timeout=10,
    ).out.strip()
    if ":" in names:
        owner, group = names.split(":", 1)

    return jsonify(
        {
            "path": path,
            "name": posixpath.basename(path) or "/",
            "is_dir": stat.S_ISDIR(mode),
            "size": s.st_size or 0,
            "mode": _mode_string(mode),
            "mtime": s.st_mtime or 0,
            "uid": uid,
            "gid": gid,
            "owner": owner,
            "group": group,
        }
    )


@bp.post("/api/preview")
@with_connection
def preview_file(conn):
    path = _required(body(), "path")
    file_stat = conn.sftp.stat(path)
    size = file_stat.st_size or 0
    ext = posixpath.splitext(path)[1].lower()

    binary_limit = MAX_IMAGE_BYTES if ext in IMAGE_MIME else MAX_PDF_BYTES if ext == ".pdf" else 0
    if binary_limit:
        kind, label = ("pdf", "PDF") if ext == ".pdf" else ("image", "Image")
        if size > binary_limit:
            return jsonify({"error": f"{label} too large to preview"})
        with conn.sftp.open(path, "rb") as f:
            f.prefetch(size)
            raw = f.read(binary_limit)
        return jsonify(
            {
                kind: True,
                "data": base64.b64encode(raw).decode("ascii"),
                "mime": IMAGE_MIME.get(ext, "application/pdf"),
                "size": size,
            }
        )

    with conn.sftp.open(path, "rb") as f:
        raw = f.read(MAX_TEXT_BYTES)
    if b"\x00" in raw[:8192]:
        return jsonify({"binary": True, "size": size})

    truncated = size > MAX_TEXT_BYTES
    try:
        content = raw.decode("utf-8")
        lossless = True
    except UnicodeDecodeError:
        content = raw.decode("utf-8", errors="replace")
        lossless = False
    return jsonify(
        {
            "content": content,
            "truncated": truncated,
            "editable": lossless and not truncated,
            "size": size,
            "mtime": file_stat.st_mtime or 0,
        }
    )


@bp.post("/api/save-file")
@with_connection
def save_file(conn):
    data = body()
    path = _required(data, "path")
    content = data.get("content") or ""
    expected_mtime = data.get("expected_mtime")

    if expected_mtime is not None:
        try:
            current = conn.sftp.stat(path).st_mtime
        except FileNotFoundError:
            current = None
        if current is not None and current != expected_mtime:
            return jsonify({"error": "The file changed on the server", "conflict": True}), 409

    with conn.sftp.open(path, "wb") as f:
        f.write(content.encode("utf-8"))
    return jsonify({"status": "ok", "mtime": conn.sftp.stat(path).st_mtime or 0})


@bp.post("/api/new-file")
@with_connection
def new_file(conn):
    path = _required(body(), "path")
    if _exists(conn, path):
        return jsonify({"error": f"{posixpath.basename(path)} already exists"}), 409
    with conn.sftp.open(path, "wx"):
        pass
    return jsonify({"status": "ok"})


@bp.post("/api/mkdir")
@with_connection
def mkdir_entry(conn):
    path = _required(body(), "path")
    if _exists(conn, path):
        return jsonify({"error": f"{posixpath.basename(path)} already exists"}), 409
    conn.sftp.mkdir(path)
    return jsonify({"status": "ok"})


@bp.post("/api/chmod")
@with_connection
def chmod_entry(conn):
    data = body()
    path = _required(data, "path")
    mode = data.get("mode")
    if not isinstance(mode, int) or not 0 <= mode <= 0o7777:
        return jsonify({"error": "mode must be between 0 and 7777 octal"}), 400
    conn.sftp.chmod(path, mode)
    return jsonify({"status": "ok", "mode": _mode_string(conn.sftp.stat(path).st_mode)})


@bp.post("/api/delete")
@with_connection
def delete_entry(conn):
    path = _required(body(), "path")
    normalized = posixpath.normpath(path)
    if normalized in ("/", posixpath.normpath(conn.home_dir)):
        return jsonify({"error": f"Refusing to delete {normalized}"}), 400

    if stat.S_ISDIR(conn.sftp.lstat(path).st_mode or 0):
        result = conn.run(f"rm -rf -- {shlex.quote(path)}", timeout=300)
        if not result.ok:
            return jsonify({"error": result.err.strip() or "Delete failed"}), 400
    else:
        conn.sftp.remove(path)
    return jsonify({"status": "ok"})


def _move(conn, src, dest):
    if _exists(conn, dest):
        raise FileExistsError(f"{posixpath.basename(dest)} already exists")
    try:
        conn.sftp.rename(src, dest)
    except (PermissionError, FileNotFoundError):
        raise
    except OSError:
        # SFTP rename cannot cross filesystems.
        result = conn.run(f"mv -- {shlex.quote(src)} {shlex.quote(dest)}", timeout=300)
        if not result.ok:
            raise OSError(result.err.strip() or "Move failed") from None


@bp.post("/api/move")
@with_connection
def move_entry(conn):
    data = body()
    src, dest = _required(data, "src"), _required(data, "dest")
    _move(conn, src, dest)
    return jsonify({"status": "ok"})


@bp.post("/api/batch-rename")
@with_connection
def batch_rename(conn):
    results = []
    for item in body().get("renames", []):
        src, dest = item.get("src"), item.get("dest")
        if not src or not dest:
            continue
        try:
            _move(conn, src, dest)
            results.append({"src": src, "dest": dest, "status": "ok"})
        except OSError as e:
            if isinstance(e, PermissionError):
                message = "Permission denied"
            elif isinstance(e, FileNotFoundError):
                message = "No such file or directory"
            else:
                message = str(e)
            results.append({"src": src, "dest": dest, "status": "error", "error": message})
    return jsonify({"results": results})


@bp.post("/api/duplicate")
@with_connection
def duplicate_entry(conn):
    path = _required(body(), "path")
    parent, basename = posixpath.split(path)
    is_dir = stat.S_ISDIR(conn.sftp.lstat(path).st_mode or 0)
    name, ext = (basename, "") if is_dir else posixpath.splitext(basename)

    copy_path = posixpath.join(parent, f"{name} copy{ext}")
    counter = 2
    while _exists(conn, copy_path):
        copy_path = posixpath.join(parent, f"{name} copy {counter}{ext}")
        counter += 1

    result = conn.run(
        f"cp -Rp -- {shlex.quote(path)} {shlex.quote(copy_path)}", timeout=600
    )
    if not result.ok:
        return jsonify({"error": result.err.strip() or "Copy failed"}), 400
    return jsonify({"status": "ok", "new_path": copy_path})


@bp.post("/api/upload")
@with_connection
def upload_file(conn):
    dest_dir = request.form.get("dest_dir", "")
    files = request.files.getlist("files")
    if not dest_dir:
        return jsonify({"error": "dest_dir is required"}), 400
    if not files:
        return jsonify({"error": "No files provided"}), 400

    uploaded = []
    errors = []
    with conn.dedicated_sftp() as sftp:
        for f in files:
            filename = posixpath.basename((f.filename or "").replace("\\", "/"))
            if not filename:
                continue
            try:
                sftp.putfo(f.stream, posixpath.join(dest_dir, filename))
                uploaded.append(filename)
            except PermissionError:
                errors.append(f"{filename}: Permission denied")
            except OSError as e:
                errors.append(f"{filename}: {e}")

    if errors and not uploaded:
        return jsonify({"error": "; ".join(errors)}), 400
    result = {"status": "ok", "uploaded": uploaded}
    if errors:
        result["errors"] = errors
    return jsonify(result)


def _attachment(chunks, filename, length=None):
    response = Response(chunks, mimetype="application/octet-stream")
    response.headers.set("Content-Disposition", "attachment", filename=filename)
    if length is not None:
        response.headers["Content-Length"] = str(length)
    return response


def _stream_file(conn, path, size):
    sftp = conn.client.open_sftp()
    try:
        remote = sftp.open(path, "rb")
    except BaseException:
        sftp.close()
        raise

    def chunks():
        try:
            remote.prefetch(size)
            while chunk := remote.read(DOWNLOAD_CHUNK_BYTES):
                yield chunk
        finally:
            remote.close()
            sftp.close()

    return chunks()


def _stream_tar(conn, path):
    parent, name = posixpath.split(path.rstrip("/"))
    channel = conn.client.get_transport().open_session(timeout=10)
    tar = f"tar -czf - -C {shlex.quote(parent or '/')} -- {shlex.quote(name)} 2>/dev/null"
    channel.exec_command("sh -c " + shlex.quote(tar))

    def chunks():
        try:
            while chunk := channel.recv(DOWNLOAD_CHUNK_BYTES):
                yield chunk
        finally:
            channel.close()

    return chunks()


@bp.get("/api/download")
@with_connection
def download(conn):
    """Stream a file, or a directory as a .tar.gz archive."""
    path = request.args.get("path", "")
    if not path:
        return jsonify({"error": "path required"}), 400
    file_stat = conn.sftp.stat(path)
    name = posixpath.basename(path.rstrip("/")) or "root"
    if stat.S_ISDIR(file_stat.st_mode or 0):
        return _attachment(_stream_tar(conn, path), name + ".tar.gz")
    size = file_stat.st_size or 0
    return _attachment(_stream_file(conn, path, size), name, length=size)


@bp.post("/api/search")
@with_connection
def search_files(conn):
    """Find entries whose name contains the query, up to five levels deep."""
    data = body()
    path, query = _required(data, "path"), _required(data, "query")

    literal = "".join("\\" + c if c in "\\*?[" else c for c in query)
    include_hidden = data.get("hidden") or "/." in path
    hidden_filter = "" if include_hidden else "! -path '*/.*' "
    script = (
        f"{TIMEOUT_FN}t {SEARCH_SECONDS} find {shlex.quote(path)} -maxdepth 5 "
        f"{hidden_filter}-iname {shlex.quote('*' + literal + '*')} "
        f"-exec ls -dp {{}} + 2>/dev/null | head -n {SEARCH_MAX_RESULTS}"
    )
    output = conn.run(script, timeout=SEARCH_SECONDS + 10).out

    results = []
    for line in output.splitlines():
        is_dir = line.endswith("/")
        full = line.rstrip("/")
        if not full or full == path.rstrip("/"):
            continue
        results.append(
            {
                "name": posixpath.basename(full),
                "path": full,
                "parent": posixpath.dirname(full) or "/",
                "is_dir": is_dir,
            }
        )
    return jsonify({"results": results, "truncated": len(results) >= SEARCH_MAX_RESULTS})


@bp.post("/api/diff")
@with_connection
def diff_files(conn):
    data = body()
    path_a, path_b = _required(data, "path_a"), _required(data, "path_b")

    def read(path):
        with conn.sftp.open(path, "rb") as f:
            return f.read(MAX_DIFF_BYTES).decode("utf-8", errors="replace")

    content_a, content_b = read(path_a), read(path_b)
    name_a, name_b = posixpath.basename(path_a), posixpath.basename(path_b)
    diff = difflib.unified_diff(
        content_a.splitlines(keepends=True),
        content_b.splitlines(keepends=True),
        fromfile=name_a,
        tofile=name_b,
    )
    return jsonify(
        {
            "diff": "".join(diff),
            "content_a": content_a,
            "content_b": content_b,
            "name_a": name_a,
            "name_b": name_b,
        }
    )


@bp.post("/api/run-command")
@with_connection
def run_command(conn):
    data = body()
    command = _required(data, "command")
    paths = data.get("paths") or []
    cwd = data.get("cwd") or ""

    if paths:
        command = command.replace("{}", " ".join(shlex.quote(p) for p in paths))
    if cwd:
        command = f"cd {shlex.quote(cwd)} && {command}"

    result = conn.run(command, timeout=30)
    return jsonify({"stdout": result.out, "stderr": result.err, "exit_code": result.code})


@bp.post("/api/git-info")
@with_connection
def git_info(conn):
    """Current branch at path and, unless author is false, who first committed it."""
    data = body()
    path = _required(data, "path")
    quoted = shlex.quote(path)

    script = [
        f"p={quoted}",
        'if [ -d "$p" ]; then d=$p; else d=$(dirname -- "$p"); fi',
        'echo "branch=$(cd "$d" 2>/dev/null && git rev-parse --abbrev-ref HEAD 2>/dev/null)"',
    ]
    if data.get("author", True):
        script.append(
            'echo "author=$(cd "$(dirname -- "$p")" 2>/dev/null && git log --diff-filter=A '
            '--follow --format=%an -- "$(basename -- "$p")" 2>/dev/null | tail -1)"'
        )
    try:
        output = conn.run("\n".join(script), timeout=20).out
    except TimeoutError:
        return jsonify({})

    result = {}
    for line in output.splitlines():
        key, _, value = line.partition("=")
        if key == "branch" and value:
            result["branch"] = value
        elif key == "author" and value:
            result["created_by"] = value
    return jsonify(result)


@bp.post("/api/git-authors")
@with_connection
def git_authors(conn):
    """First-commit author for each named entry of a directory."""
    data = body()
    path = _required(data, "path")
    names = data.get("names") or []
    if not names:
        return jsonify({"authors": {}})

    script = [f"cd {shlex.quote(path)} && git rev-parse --git-dir >/dev/null 2>&1 || exit 0"]
    for i, name in enumerate(names):
        script.append(
            f'echo "{i} $(git log --diff-filter=A --follow --format=%an '
            f"-- {shlex.quote(name)} 2>/dev/null | tail -1)\""
        )
    try:
        output = conn.run("\n".join(script), timeout=60).out
    except TimeoutError:
        return jsonify({"authors": {}})

    authors = {}
    for line in output.splitlines():
        index, _, author = line.partition(" ")
        if index.isdigit() and int(index) < len(names) and author.strip():
            authors[names[int(index)]] = author.strip()
    return jsonify({"authors": authors})
