// ── File Upload ──────────────────────────────────────────────────────

async function listNames(dirPath) {
  const col = state.columns.find((c) => c.path === dirPath && c.entries);
  if (col) return new Set(col.entries.map((e) => e.name));
  try {
    const data = await cachedPost("/api/ls", { path: dirPath }, 30000);
    return new Set((data.entries || []).map((e) => e.name));
  } catch {
    return new Set();
  }
}

async function handleFileUpload(fileList, destDir) {
  // Copy first: the source FileList is cleared once the caller returns.
  const files = [...fileList];
  const existing = await listNames(destDir);
  const clashes = files.filter((f) => existing.has(f.name));
  if (clashes.length > 0) {
    const what =
      clashes.length === 1
        ? `"${clashes[0].name}" already exists`
        : `${clashes.length} files already exist`;
    if (!confirm(`${what} in ${destDir}. Replace?`)) return;
  }

  const formData = new FormData();
  formData.append("dest_dir", destDir);
  for (const file of files) {
    formData.append("files", file);
  }

  let progressEl = document.getElementById("upload-progress");
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.id = "upload-progress";
    progressEl.className = "upload-progress";
    document.body.appendChild(progressEl);
  }
  progressEl.innerHTML = `
    <div class="upload-progress-text">Uploading ${files.length} file(s)...</div>
    <div class="upload-progress-track"><div class="upload-progress-bar" id="upload-bar"></div></div>`;
  progressEl.style.display = "flex";

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const bar = document.getElementById("upload-bar");
        if (bar) bar.style.width = pct + "%";
        const text = progressEl.querySelector(".upload-progress-text");
        if (text) text.textContent = `Uploading... ${pct}%`;
      }
    };
    xhr.onload = () => {
      progressEl.style.display = "none";
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = { error: `Upload failed (HTTP ${xhr.status})` };
      }
      const problem = data.error || (data.errors || []).join("; ");
      if (problem) showNotification(problem, "error");
      else
        showNotification(
          `Uploaded ${data.uploaded?.length || 0} file(s)`,
          "success",
        );
      refreshColumns().then(resolve);
    };
    xhr.onerror = () => {
      progressEl.style.display = "none";
      showNotification("Upload failed", "error");
      resolve();
    };
    xhr.open("POST", "/api/upload");
    xhr.setRequestHeader("X-Connection-Id", state.connectionId);
    xhr.send(formData);
  });
}

function triggerUpload(destDir) {
  const input = document.getElementById("upload-input");
  input.onchange = () => {
    if (input.files.length > 0) {
      handleFileUpload(input.files, destDir);
    }
    input.value = "";
  };
  input.click();
}

// ── Clipboard Paste Upload ───────────────────────────────────────────

function setupClipboardPaste() {
  document.addEventListener("paste", (e) => {
    if (!state.connected) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (document.activeElement?.closest("#terminal-container")) return;
    const files = e.clipboardData?.files;
    if (!files || files.length === 0) return;
    const col = state.columns[state.focusedColumn];
    if (!col || !col.path) return;
    e.preventDefault();
    handleFileUpload(files, col.path);
  });
}

// ── Text Editor ──────────────────────────────────────────────────────

function resetEditing() {
  state.editing = {
    active: false,
    path: null,
    originalContent: null,
    draft: null,
    mtime: null,
    crlf: false,
  };
}

function hasUnsavedEdits() {
  if (!state.editing.active) return false;
  const textarea = document.getElementById("editor-textarea");
  const current = textarea ? textarea.value : state.editing.draft;
  return current !== state.editing.originalContent;
}

function confirmDiscardEdits() {
  if (!state.editing.active) return true;
  if (hasUnsavedEdits()) {
    const name = state.editing.path.split("/").pop();
    if (!confirm(`Discard unsaved changes to ${name}?`)) return false;
  }
  resetEditing();
  return true;
}

function captureEditorState() {
  const textarea = document.getElementById("editor-textarea");
  if (!textarea || !state.editing.active) return null;
  state.editing.draft = textarea.value;
  return {
    focused: document.activeElement === textarea,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    scrollTop: textarea.scrollTop,
  };
}

function restoreEditorState(saved) {
  const textarea = document.getElementById("editor-textarea");
  if (!textarea || !saved) return;
  textarea.scrollTop = saved.scrollTop;
  if (saved.focused) {
    textarea.focus();
    textarea.setSelectionRange(saved.start, saved.end);
  }
}

function handleEditorKey(e) {
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const textarea = e.target;
    textarea.setRangeText(
      "\t",
      textarea.selectionStart,
      textarea.selectionEnd,
      "end",
    );
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEditing();
  }
}

function startEditing() {
  const previewCol = state.columns.find(
    (c) => c.filePreview && c.filePreview.content != null,
  );
  if (!previewCol) return;
  const preview = previewCol.filePreview;
  // A textarea reports its value with LF line endings only.
  const normalized = preview.content.replace(/\r\n/g, "\n");
  state.editing = {
    active: true,
    path: preview.path,
    originalContent: normalized,
    draft: normalized,
    mtime: preview.mtime ?? null,
    crlf: /\r\n/.test(preview.content) && !/(^|[^\r])\n/.test(preview.content),
  };
  renderColumns();
  const textarea = document.getElementById("editor-textarea");
  if (textarea) {
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  }
}

async function saveEditedFile(overwrite = false) {
  const textarea = document.getElementById("editor-textarea");
  if (!textarea || !state.editing.active) return;
  const path = state.editing.path;
  const content = state.editing.crlf
    ? textarea.value.replace(/\n/g, "\r\n")
    : textarea.value;
  const body = { path, content };
  if (!overwrite && state.editing.mtime != null) {
    body.expected_mtime = state.editing.mtime;
  }

  try {
    const resp = await fetch("/api/save-file", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.conflict) {
      if (confirm("The file changed on the server since you opened it. Overwrite it?")) {
        await saveEditedFile(true);
      }
      return;
    }
    if (data.error) {
      showNotification(data.error, "error");
      return;
    }
    showNotification("File saved", "success");
    resetEditing();
    apiCache.invalidateUrl("/api/preview");
    const previewCol = state.columns.find(
      (c) => c.filePreview && c.filePreview.path === path,
    );
    if (previewCol) {
      previewCol.filePreview.content = content;
      previewCol.filePreview.mtime = data.mtime;
      previewCol.filePreview.loaded = true;
    }
    renderColumns();
  } catch (e) {
    showNotification("Save failed: " + e.message, "error");
  }
}

function cancelEditing() {
  if (!confirmDiscardEdits()) return;
  renderColumns();
}

// ── Quick Look (Spacebar) ────────────────────────────────────────────

async function toggleQuickLook() {
  if (state.quickLook.active) {
    hideQuickLook();
    return;
  }
  const info = getSelectedEntryInfo();
  if (!info || info.entry.is_dir) return;
  state.quickLook = { active: true, path: info.fullPath };
  try {
    const data = await cachedPost(
      "/api/preview",
      { path: info.fullPath },
      120000,
    );
    if (!state.quickLook.active) return;
    showQuickLookModal(data, info.entry.name);
  } catch {
    hideQuickLook();
  }
}

function showQuickLookModal(data, name) {
  let body;
  if (data.image) {
    body = `<img class="ql-image" src="data:${data.mime};base64,${data.data}" />`;
  } else if (data.pdf) {
    body = `<iframe class="ql-pdf" src="data:application/pdf;base64,${data.data}"></iframe>`;
  } else if (data.binary) {
    body = '<div class="ql-message">Binary file</div>';
  } else if (data.content != null) {
    body = `<pre class="ql-code">${escapeHtml(data.content)}</pre>`;
  } else if (data.error) {
    body = `<div class="ql-message">${escapeHtml(data.error)}</div>`;
  } else {
    body = '<div class="ql-message">No preview</div>';
  }
  const overlay = document.createElement("div");
  overlay.id = "quicklook-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="ql-panel">
      <div class="ql-header"><span>${escapeHtml(name)}</span><button class="btn btn-icon" onclick="hideQuickLook()">${CTX.xmark}</button></div>
      <div class="ql-body">${body}</div>
    </div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hideQuickLook();
  });
  document.body.appendChild(overlay);
}

function hideQuickLook() {
  state.quickLook = { active: false, path: null };
  const el = document.getElementById("quicklook-overlay");
  if (el) el.remove();
}

// ── Undo Stack ───────────────────────────────────────────────────────

function pushUndo(action) {
  state.undoStack.push(action);
  if (state.undoStack.length > 30) state.undoStack.shift();
}

async function undoLastAction() {
  const action = state.undoStack.pop();
  if (!action) {
    showNotification("Nothing to undo", "info");
    return;
  }
  try {
    if (action.type === "rename" || action.type === "move") {
      const resp = await fetch("/api/move", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ src: action.dest, dest: action.src }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        showNotification("Undo failed: " + (err.error || resp.status), "error");
        return;
      }
      showNotification(`Undid ${action.type}`, "success");
    } else if (action.type === "delete") {
      showNotification("Cannot undo delete", "error");
      return;
    }
  } catch (e) {
    showNotification("Undo failed: " + e.message, "error");
    return;
  }
  await refreshColumns();
}

// ── Custom Commands ──────────────────────────────────────────────────

function showCustomCommandDialog(paths, cwd) {
  const overlay = document.createElement("div");
  overlay.id = "command-overlay";
  overlay.className = "modal-overlay";
  const recentCmds = JSON.parse(localStorage.getItem("recentCommands") || "[]");
  const recentHtml = recentCmds
    .map(
      (c) =>
        `<div class="command-history-item" data-cmd="${escapeHtml(c)}">${escapeHtml(c)}</div>`,
    )
    .join("");
  overlay.innerHTML = `
    <div class="modal-dialog command-dialog">
      <div class="modal-title">Run Command</div>
      <p class="modal-hint">Use {} for selected file paths</p>
      <input id="command-input" class="modal-input" type="text" placeholder="e.g. wc -l {}" />
      ${recentHtml ? `<div class="command-history">${recentHtml}</div>` : ""}
      <pre id="command-output" class="command-output" style="display:none"></pre>
      <div class="modal-actions">
        <button class="btn btn-save" id="command-run-btn">Run</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('command-overlay').remove()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const input = document.getElementById("command-input");
  input.focus();
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") runCommandFromDialog(paths, cwd);
    if (e.key === "Escape") overlay.remove();
  });
  document
    .getElementById("command-run-btn")
    .addEventListener("click", () => runCommandFromDialog(paths, cwd));
  overlay.querySelectorAll(".command-history-item").forEach((el) => {
    el.addEventListener("click", () => {
      input.value = el.dataset.cmd;
    });
  });
}

async function runCommandFromDialog(paths, cwd) {
  const input = document.getElementById("command-input");
  const output = document.getElementById("command-output");
  const cmd = input.value.trim();
  if (!cmd) return;
  // Save to recent
  const recent = JSON.parse(localStorage.getItem("recentCommands") || "[]");
  if (!recent.includes(cmd)) {
    recent.unshift(cmd);
    if (recent.length > 10) recent.pop();
  }
  localStorage.setItem("recentCommands", JSON.stringify(recent));
  output.style.display = "block";
  output.textContent = "Running...";
  try {
    const resp = await fetch("/api/run-command", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ command: cmd, paths, cwd }),
    });
    const data = await resp.json();
    if (data.error) {
      output.textContent = data.error;
    } else {
      output.textContent =
        (data.stdout || "") + (data.stderr ? "\n" + data.stderr : "");
    }
  } catch (e) {
    output.textContent = "Error: " + e.message;
  }
}

// ── Diff View ────────────────────────────────────────────────────────

async function showDiffView(pathA, pathB) {
  try {
    const data = await fetch("/api/diff", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path_a: pathA, path_b: pathB }),
    }).then((r) => r.json());
    if (data.error) {
      showNotification(data.error, "error");
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = "diff-overlay";
    overlay.className = "modal-overlay";

    const linesA = data.content_a.split("\n");
    const linesB = data.content_b.split("\n");
    const maxLines = Math.max(linesA.length, linesB.length);
    let colA = "",
      colB = "";
    for (let i = 0; i < maxLines; i++) {
      const lineA = linesA[i] !== undefined ? escapeHtml(linesA[i]) : "";
      const lineB = linesB[i] !== undefined ? escapeHtml(linesB[i]) : "";
      const cls = linesA[i] !== linesB[i] ? " diff-changed" : "";
      colA += `<div class="diff-line${cls}"><span class="diff-num">${i + 1}</span>${lineA}</div>`;
      colB += `<div class="diff-line${cls}"><span class="diff-num">${i + 1}</span>${lineB}</div>`;
    }

    overlay.innerHTML = `
      <div class="diff-panel">
        <div class="diff-header">
          <span>${escapeHtml(data.name_a)} vs ${escapeHtml(data.name_b)}</span>
          <button class="btn btn-icon" onclick="document.getElementById('diff-overlay').remove()">${CTX.xmark}</button>
        </div>
        <div class="diff-body">
          <div class="diff-column"><div class="diff-col-header">${escapeHtml(data.name_a)}</div>${colA}</div>
          <div class="diff-column"><div class="diff-col-header">${escapeHtml(data.name_b)}</div>${colB}</div>
        </div>
      </div>`;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  } catch (e) {
    showNotification("Diff failed: " + e.message, "error");
  }
}

// ── Batch Rename ─────────────────────────────────────────────────────

function showBatchRenameDialog(colIndex) {
  const col = state.columns[colIndex];
  if (!col) return;
  const names = [...col.selected];
  if (names.length < 2) return;

  const overlay = document.createElement("div");
  overlay.id = "batchrename-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog batch-rename-dialog">
      <div class="modal-title">Batch Rename (${names.length} files)</div>
      <div class="modal-hint">Find and replace in file names</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="br-find" class="modal-input" placeholder="Find..." style="flex:1" />
        <input id="br-replace" class="modal-input" placeholder="Replace with..." style="flex:1" />
      </div>
      <div id="br-preview" class="batch-rename-preview"></div>
      <div class="modal-actions">
        <button class="btn btn-save" id="br-apply">Rename</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('batchrename-overlay').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const findInput = document.getElementById("br-find");
  const replaceInput = document.getElementById("br-replace");
  const preview = document.getElementById("br-preview");

  function updatePreview() {
    const find = findInput.value;
    const replace = replaceInput.value;
    if (!find) {
      preview.innerHTML = names
        .map((n) => `<div class="br-row">${escapeHtml(n)}</div>`)
        .join("");
      return;
    }
    preview.innerHTML = names
      .map((n) => {
        const newName = n.split(find).join(replace);
        const changed = newName !== n;
        return `<div class="br-row${changed ? " br-changed" : ""}"><span class="br-old">${escapeHtml(n)}</span><span class="br-arrow">&rarr;</span><span class="br-new">${escapeHtml(newName)}</span></div>`;
      })
      .join("");
  }
  findInput.addEventListener("input", updatePreview);
  replaceInput.addEventListener("input", updatePreview);
  [findInput, replaceInput].forEach((el) =>
    el.addEventListener("keydown", (e) => e.stopPropagation()),
  );
  updatePreview();

  document.getElementById("br-apply").addEventListener("click", async () => {
    const find = findInput.value;
    const replace = replaceInput.value;
    if (!find) return;
    const renames = [];
    for (const n of names) {
      const newName = n.split(find).join(replace);
      if (newName !== n && newName) {
        const src = col.path === "/" ? "/" + n : col.path + "/" + n;
        const dest =
          col.path === "/" ? "/" + newName : col.path + "/" + newName;
        renames.push({ src, dest });
      }
    }
    if (renames.length === 0) return;
    try {
      const data = await fetch("/api/batch-rename", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ renames }),
      }).then((r) => r.json());
      const results = data.results || [];
      const renamed = results.filter((r) => r.status === "ok");
      const failed = results.length - renamed.length;
      if (data.error || failed > 0) {
        showNotification(
          data.error || `${failed} of ${results.length} renames failed`,
          "error",
        );
      } else {
        showNotification(`Renamed ${renamed.length} files`, "success");
      }
      for (const r of renamed)
        pushUndo({ type: "rename", src: r.src, dest: r.dest });
    } catch (e) {
      showNotification("Batch rename failed: " + e.message, "error");
    }
    overlay.remove();
    await refreshColumns();
  });
  findInput.focus();
}
