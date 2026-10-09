// ── File Browser ─────────────────────────────────────────────────────

async function navigateTo(path) {
  if (!confirmDiscardEdits()) return;
  if (navAbortController) navAbortController.abort();
  navAbortController = new AbortController();
  const signal = navAbortController.signal;
  try {
    const data = await cachedPost("/api/ls", { path }, 30000, signal);
    if (data.error) {
      showNotification(data.error || "Failed to list directory", "error");
      return;
    }
    state.columns = [
      {
        path: data.path,
        entries: data.entries,
        mtime: data.mtime,
        selected: new Set(),
        lastClickedIndex: -1,
        selectionCursor: -1,
      },
    ];
    state.focusedColumn = 0;
    if (!state.historyPaused) pushHistory(data.path);
    renderColumns();
    updateBreadcrumb();
    updateNavButtons();
    renderSidebar();
    fetchDirSizes(0);
    fetchGitBranch(data.path);
    if (state.sortMode === "creator") fetchColumnAuthors();
  } catch (e) {
    if (e.name === "AbortError") return;
    showNotification("Failed to browse: " + e.message, "error");
  }
}

function navigateToBreadcrumb(path) {
  // Check if this path exists in the current columns
  const colIndex = state.columns.findIndex((c) => c.path === path);
  if (colIndex >= 0) {
    if (!confirmDiscardEdits()) return;
    // Truncate columns after this one, clear its selection
    state.columns = state.columns.slice(0, colIndex + 1);
    state.columns[colIndex].selected = new Set();
    state.columns[colIndex].lastClickedIndex = -1;
    state.columns[colIndex].selectionCursor = -1;
    state.focusedColumn = colIndex;
    renderColumns();
    updateBreadcrumb();
    return;
  }
  // Path is above our current root -- load fresh
  navigateTo(path);
}

function navigateHome() {
  if (state.homeDir) {
    navigateTo(state.homeDir);
  }
}

async function selectEntry(colIndex, entry, opts = {}) {
  if (!confirmDiscardEdits()) return;
  if (navAbortController) navAbortController.abort();
  navAbortController = new AbortController();
  const signal = navAbortController.signal;
  const gen = ++selectGeneration;
  const column = state.columns[colIndex];
  const entries = getVisibleEntries(column);
  const clickedIndex = entries.findIndex((e) => e.name === entry.name);

  if (opts.shift && column.lastClickedIndex >= 0) {
    const start = Math.min(column.lastClickedIndex, clickedIndex);
    const end = Math.max(column.lastClickedIndex, clickedIndex);
    column.selected = new Set();
    for (let i = start; i <= end; i++) {
      column.selected.add(entries[i].name);
    }
    column.selectionCursor = clickedIndex;
  } else {
    column.selected = new Set([entry.name]);
    column.lastClickedIndex = clickedIndex;
    column.selectionCursor = clickedIndex;
  }

  state.columns = state.columns.slice(0, colIndex + 1);

  if (entry.is_dir) {
    const currentPath = state.columns[colIndex].path;
    const newPath =
      currentPath === "/" ? "/" + entry.name : currentPath + "/" + entry.name;

    // Show selection and a loading column immediately
    state.focusedColumn = colIndex;
    state.columns.push({ path: newPath, loading: true });
    renderColumns();

    try {
      const data = await cachedPost(
        "/api/ls",
        { path: newPath },
        30000,
        signal,
      );

      if (gen !== selectGeneration) return; // stale

      if (!data.error) {
        // Re-truncate in case state changed during await
        state.columns = state.columns.slice(0, colIndex + 1);
        state.columns.push({
          path: data.path,
          entries: data.entries,
          mtime: data.mtime,
          selected: new Set(),
          lastClickedIndex: -1,
          selectionCursor: -1,
        });
        fetchDirSizes(state.columns.length - 1);
        fetchGitBranch(data.path);
        if (state.sortMode === "creator") fetchColumnAuthors();
      } else {
        state.columns = state.columns.slice(0, colIndex + 1);
        state.columns.push({
          path: newPath,
          entries: [],
          selected: new Set(),
          lastClickedIndex: -1,
          selectionCursor: -1,
          error: data.error,
        });
      }
    } catch (e) {
      if (e.name === "AbortError" || gen !== selectGeneration) return;
      state.columns = state.columns.slice(0, colIndex + 1);
      state.columns.push({
        path: newPath,
        entries: [],
        selected: new Set(),
        lastClickedIndex: -1,
        selectionCursor: -1,
        error: e.message,
      });
    }
  } else {
    const currentPath = state.columns[colIndex].path;
    const filePath =
      currentPath === "/" ? "/" + entry.name : currentPath + "/" + entry.name;

    const fileInfo = {
      name: entry.name,
      path: filePath,
      size: entry.size,
      mode: entry.mode,
      mtime: entry.mtime,
      is_link: entry.is_link,
    };

    state.columns.push({
      path: null,
      entries: [],
      selected: new Set(),
      lastClickedIndex: -1,
      selectionCursor: -1,
      fileInfo,
    });

    const isImage = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(entry.name);
    const isPdf = /\.pdf$/i.test(entry.name);
    const maxPreviewSize = isImage
      ? 5 * 1024 * 1024
      : isPdf
        ? 10 * 1024 * 1024
        : 1024 * 1024;
    if (entry.size <= maxPreviewSize) {
      state.columns.push({
        path: null,
        entries: [],
        selected: new Set(),
        lastClickedIndex: -1,
        selectionCursor: -1,
        filePreview: { path: filePath, name: entry.name },
      });
      fetchPreview(filePath);
    }
  }

  state.focusedColumn = colIndex;
  renderColumns();
  updateBreadcrumb();

  const columnsEl = document.getElementById("columns");
  setTimeout(() => {
    columnsEl.scrollTo({
      left: columnsEl.scrollWidth,
      behavior: "smooth",
    });
  }, 50);
}

async function fetchPreview(filePath) {
  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: filePath }),
    });
    const data = await response.json();

    // Find the preview column that matches this path
    const previewCol = state.columns.find(
      (c) => c.filePreview && c.filePreview.path === filePath,
    );
    if (!previewCol) return;

    if (data.error) {
      previewCol.filePreview.error = data.error;
    } else if (data.pdf) {
      previewCol.filePreview.pdf = true;
      previewCol.filePreview.pdfData = data.data;
    } else if (data.image) {
      previewCol.filePreview.image = true;
      previewCol.filePreview.imageData = data.data;
      previewCol.filePreview.imageMime = data.mime;
    } else if (data.binary) {
      previewCol.filePreview.binary = true;
    } else {
      previewCol.filePreview.content = data.content;
      previewCol.filePreview.truncated = data.truncated;
      previewCol.filePreview.editable = data.editable;
      previewCol.filePreview.mtime = data.mtime;
    }
    previewCol.filePreview.loaded = true;

    renderColumns();
  } catch (e) {
    // Silently fail preview
  }
}

function getVisibleEntries(column) {
  if (!column || column.fileInfo || column.error) return [];
  let entries = column.entries.filter(
    (e) => state.showHidden || !e.name.startsWith("."),
  );

  // Apply search filter
  if (state.search.active && state.search.query) {
    const q = state.search.query.toLowerCase();
    entries = entries.filter((e) => e.name.toLowerCase().includes(q));
  }

  entries = sortEntries(entries, state.sortMode, state.sortAsc);
  return entries;
}

function sortEntries(entries, mode, asc) {
  const sorted = [...entries];
  const dir = asc ? 1 : -1;

  switch (mode) {
    case "kind": {
      sorted.sort((a, b) => {
        // Folders always first
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        if (!a.is_dir) {
          // Group by extension
          const extA = getExtension(a.name);
          const extB = getExtension(b.name);
          if (extA !== extB) return extA.localeCompare(extB) * dir;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      });
      break;
    }
    case "size": {
      sorted.sort((a, b) => {
        // Folders at end in size sort (no meaningful size)
        if (a.is_dir !== b.is_dir) return a.is_dir ? 1 : -1;
        if (!a.is_dir && a.size !== b.size) return (a.size - b.size) * dir;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
    }
    case "creator": {
      sorted.sort((a, b) => {
        const authorA = (a._gitAuthor || a.owner || "").toLowerCase();
        const authorB = (b._gitAuthor || b.owner || "").toLowerCase();
        if (!authorA && authorB) return 1;
        if (authorA && !authorB) return -1;
        if (authorA !== authorB) return authorA.localeCompare(authorB) * dir;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
      break;
    }
    default: {
      // "name" -- mixed files and folders, purely alphabetical
      sorted.sort((a, b) => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
      });
    }
  }
  return sorted;
}

function getExtension(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

async function changeSort() {
  const select = document.getElementById("sort-select");
  state.sortMode = select.value;
  renderColumns();
  updateSortDirIcon();
  if (state.sortMode === "creator") {
    await fetchColumnAuthors();
  }
}

async function fetchColumnAuthors() {
  // Fetch git authors for all visible directory columns
  for (let i = 0; i < state.columns.length; i++) {
    const col = state.columns[i];
    if (!col.path || col.fileInfo || col.filePreview) continue;
    // Skip if authors already loaded for these entries
    if (col.entries.some((e) => e._gitAuthor)) continue;
    const names = col.entries.map((e) => e.name);
    if (names.length === 0) continue;
    try {
      const data = await cachedPost(
        "/api/git-authors",
        { path: col.path, names },
        120000,
      );
      if (data.authors) {
        for (const entry of col.entries) {
          if (data.authors[entry.name]) {
            entry._gitAuthor = data.authors[entry.name];
          }
        }
        renderColumns();
      }
    } catch {
      // not in a git repo
    }
  }
}

function toggleSortDirection() {
  state.sortAsc = !state.sortAsc;
  renderColumns();
  updateSortDirIcon();
}

function updateSortDirIcon() {
  const btn = document.getElementById("sort-dir-btn");
  if (btn) {
    btn.title = state.sortAsc ? "Ascending" : "Descending";
    btn.style.transform = state.sortAsc ? "" : "scaleY(-1)";
  }
}

function renderColumns() {
  const container = document.getElementById("columns");
  const editorState = captureEditorState();

  // Save scroll positions before destroying DOM
  const scrollPositions = [];
  container.querySelectorAll(":scope > .column").forEach((col) => {
    scrollPositions.push(col.scrollTop);
  });

  container.innerHTML = "";

  state.columns.forEach((column, colIndex) => {
    const colEl = document.createElement("div");

    // Loading column
    if (column.loading) {
      colEl.className = "column";
      colEl.innerHTML =
        '<div class="column-loading"><div class="spinner"></div></div>';
      if (column.width) {
        colEl.style.minWidth = column.width + "px";
        colEl.style.width = column.width + "px";
      }
      container.appendChild(colEl);
      if (colIndex < state.columns.length - 1) {
        container.appendChild(createColumnResizeHandle(colIndex, colEl));
      }
      return;
    }

    // File preview column
    if (column.filePreview) {
      colEl.className = "column file-preview-panel";
      const preview = column.filePreview;

      if (column.width) {
        colEl.style.minWidth = column.width + "px";
        colEl.style.width = column.width + "px";
      }

      let bodyHtml;
      if (!preview.loaded) {
        bodyHtml = '<div class="file-preview-message">Loading...</div>';
      } else if (preview.error) {
        bodyHtml = `<div class="file-preview-message">${escapeHtml(preview.error)}</div>`;
      } else if (preview.pdf) {
        bodyHtml = `<div class="file-preview-pdf"><iframe src="data:application/pdf;base64,${preview.pdfData}" style="width:100%;height:100%;border:none;"></iframe></div>`;
      } else if (preview.image) {
        bodyHtml = `<div class="file-preview-image"><img src="data:${preview.imageMime};base64,${preview.imageData}" /></div>`;
      } else if (preview.binary) {
        bodyHtml =
          '<div class="file-preview-message">Binary file -- cannot preview</div>';
      } else if (preview.content != null) {
        const isEditing =
          state.editing.active && state.editing.path === preview.path;
        if (isEditing) {
          // The HTML parser drops one newline directly after <textarea>.
          bodyHtml = `<textarea class="file-editor-textarea" id="editor-textarea" spellcheck="false">\n${escapeHtml(state.editing.draft)}</textarea>`;
        } else {
          const lines = preview.content.split("\n");
          const lineNums = lines
            .map((_, i) => `<span>${i + 1}</span>`)
            .join("\n");
          const code = escapeHtml(preview.content);
          const wrapClass = state.previewWrap ? " wrapped" : "";
          bodyHtml = `<div class="file-preview-code"><div class="file-preview-lines">${lineNums}</div><pre class="file-preview-content${wrapClass}">${code}</pre></div>`;
          if (preview.truncated) {
            bodyHtml +=
              '<div class="file-preview-message">Truncated -- first 64KB shown</div>';
          }
        }
      } else {
        bodyHtml =
          '<div class="file-preview-message">No preview available</div>';
      }

      const isEditing =
        state.editing.active && state.editing.path === preview.path;
      const isTextFile =
        preview.content != null &&
        !preview.truncated &&
        preview.editable !== false;
      const wrapBtnClass = state.previewWrap ? " active" : "";
      const wrapTitle = state.previewWrap
        ? "Scroll horizontally"
        : "Wrap lines";

      let actionsHtml;
      if (isEditing) {
        actionsHtml = `
          <button class="btn btn-save" onclick="saveEditedFile()">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="cancelEditing()">Cancel</button>`;
      } else {
        actionsHtml = `
          <button class="btn btn-icon preview-wrap-btn${wrapBtnClass}" onclick="togglePreviewWrap()" title="${wrapTitle}">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1.75 2a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75zm0 5a.75.75 0 0 0 0 1.5h7.5c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25H8.5v-.75a.75.75 0 0 0-1.28-.53l-1.5 1.5a.75.75 0 0 0 0 1.06l1.5 1.5A.75.75 0 0 0 8.5 13v-.75h.75a2.75 2.75 0 0 0 0-5.5h-7.5zM1.75 14a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75z"/>
              </svg>
          </button>
          ${isTextFile ? '<button class="btn btn-sm btn-edit" onclick="startEditing()">Edit</button>' : '<span class="file-preview-readonly">Read-only</span>'}`;
      }

      colEl.innerHTML = `
                <div class="file-preview-header">
                    <span class="file-preview-title">${escapeHtml(preview.name)}</span>
                    <div class="file-preview-actions">${actionsHtml}</div>
                </div>
                ${bodyHtml}
            `;

      container.appendChild(colEl);
      if (colIndex < state.columns.length - 1) {
        container.appendChild(createColumnResizeHandle(colIndex, colEl));
      }
      return;
    }

    // File info panel
    if (column.fileInfo) {
      colEl.className = "column file-info-panel";
      const info = column.fileInfo;
      const perms = humanizePermissions(info.mode);

      const permBits = parseModeBits(info.mode);

      const infoIcon = info.is_dir
        ? FOLDER_ICON.replace('width="16"', 'width="48"').replace(
            'height="16"',
            'height="48"',
          )
        : FILE_ICON_LARGE;
      const badge = info.is_dir ? "Folder" : info.is_link ? "Symlink" : "";

      colEl.innerHTML = `
                <div class="file-info-header">
                    <div class="file-info-icon">${infoIcon}</div>
                    <div class="file-info-name">${escapeHtml(info.name)} <span class="copy-icon" onclick="copyToClipboard(${jsAttr(info.name)})" title="Copy name">${COPY_ICON}</span></div>
                    ${badge ? `<div class="file-info-badge">${badge}</div>` : ""}
                </div>
                <div class="file-info-details">
                    <div class="file-info-section">
                        <div class="file-info-section-title">General</div>
                        ${
                          !info.is_dir
                            ? `<div class="file-info-row">
                            <span class="label">Size</span>
                            <span class="value">${formatSize(info.size)}</span>
                        </div>`
                            : ""
                        }
                        <div class="file-info-row">
                            <span class="label">Modified</span>
                            <span class="value">${formatDate(info.mtime)}</span>
                        </div>
                        ${
                          info.owner
                            ? `<div class="file-info-row">
                            <span class="label">Owner</span>
                            <span class="value">${escapeHtml(info.owner)}${info.group ? ":" + escapeHtml(info.group) : ""}</span>
                        </div>`
                            : ""
                        }
                        ${
                          info._gitAuthor
                            ? `<div class="file-info-row">
                            <span class="label">Created by</span>
                            <span class="value">${escapeHtml(info._gitAuthor)}</span>
                        </div>`
                            : ""
                        }
                    </div>
                    <div class="file-info-section">
                        <div class="file-info-section-title">Permissions <span class="file-info-raw-mode">${escapeHtml(info.mode)}</span></div>
                        <div class="chmod-grid">
                            ${chmodRow(info.path, permBits, "owner", "Owner")}
                            ${chmodRow(info.path, permBits, "group", "Group")}
                            ${chmodRow(info.path, permBits, "others", "Others")}
                        </div>
                    </div>
                </div>
            `;

      if (column.width) {
        colEl.style.minWidth = column.width + "px";
        colEl.style.maxWidth = column.width + "px";
      }

      container.appendChild(colEl);

      // Fetch owner/group and git author asynchronously
      if (!info._statFetched) {
        info._statFetched = true;
        fetchStatInfo(info.path, colIndex);
        fetchGitInfo(info.path, colIndex);
      }

      // Resize handle after each column except the last
      if (colIndex < state.columns.length - 1) {
        container.appendChild(createColumnResizeHandle(colIndex, colEl));
      }
      return;
    }

    colEl.className = "column";
    if (colIndex === state.focusedColumn) {
      colEl.classList.add("focused");
    }

    // Apply stored width
    if (column.width) {
      colEl.style.minWidth = column.width + "px";
      colEl.style.width = column.width + "px";
    }

    // Error state
    if (column.error) {
      colEl.innerHTML = `<div class="column-error">${escapeHtml(column.error)}</div>`;
      container.appendChild(colEl);
      if (colIndex < state.columns.length - 1) {
        container.appendChild(createColumnResizeHandle(colIndex, colEl));
      }
      return;
    }

    const entries = getVisibleEntries(column);

    if (entries.length === 0) {
      const allHidden = column.entries.length > 0 && !state.showHidden;
      colEl.innerHTML = `<div class="column-empty">${allHidden ? "Only hidden files" : "Empty directory"}</div>`;
      container.appendChild(colEl);
      if (colIndex < state.columns.length - 1) {
        container.appendChild(createColumnResizeHandle(colIndex, colEl));
      }
      return;
    }

    let lastCreatorSection = null;
    const hasAnyCreator =
      state.sortMode === "creator" &&
      entries.some((e) => e._gitAuthor || e.owner);
    entries.forEach((entry) => {
      // Show section headers when sorting by creator
      if (hasAnyCreator) {
        const author = entry._gitAuthor || entry.owner || "Unknown";
        if (author !== lastCreatorSection) {
          lastCreatorSection = author;
          const header = document.createElement("div");
          header.className = "column-section-header";
          header.textContent = author;
          colEl.appendChild(header);
        }
      }
      const entryEl = document.createElement("div");
      entryEl.className = "column-entry";
      if (column.selected.has(entry.name)) {
        entryEl.classList.add("selected");
      }

      // Check if this entry is being renamed
      const isRenaming =
        state.renaming &&
        state.renaming.colIndex === colIndex &&
        state.renaming.name === entry.name;

      // Drag-and-drop attributes (not while renaming)
      entryEl.draggable = !isRenaming;

      const icon = entry.is_dir ? FOLDER_ICON : FILE_ICON;
      const linkClass = entry.is_link ? " is-link" : "";

      let rightContent;
      if (entry.is_dir) {
        const dirSizeStr =
          entry.dirSize != null ? formatSize(entry.dirSize) : "--";
        rightContent = `<span class="entry-size">${dirSizeStr}</span><span class="entry-chevron">&#x203A;</span>`;
      } else {
        rightContent = `<span class="entry-size">${formatSize(entry.size)}</span>`;
      }

      if (isRenaming) {
        entryEl.innerHTML = `
                  <span class="entry-icon">${icon}</span>
                  <input id="rename-input" class="rename-input" type="text" value="${escapeHtml(entry.name)}" />
              `;
        // Set up rename input event handlers after appending
        setTimeout(() => {
          const input = document.getElementById("rename-input");
          if (!input) return;
          input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename(colIndex, entry.name, input.value.trim());
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          });
          input.addEventListener("blur", () => {
            if (state.renaming) cancelRename();
          });
        }, 0);
      } else {
        entryEl.innerHTML = `
                  <span class="entry-icon">${icon}</span>
                  <span class="entry-name${linkClass}">${escapeHtml(entry.name)}</span>
                  ${rightContent}
              `;
      }

      // Click handler with shift support
      if (!isRenaming) {
        entryEl.addEventListener("click", (e) => {
          state.focusedColumn = colIndex;
          selectEntry(colIndex, entry, { shift: e.shiftKey });
          focusColumns();
        });

        // Double-click to rename
        entryEl.addEventListener("dblclick", (e) => {
          e.preventDefault();
          startRename(colIndex, entry.name);
        });

        // Right-click context menu
        entryEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          // Select the entry if not already selected
          if (!column.selected.has(entry.name)) {
            state.focusedColumn = colIndex;
            selectEntry(colIndex, entry);
          }
          const fullPath =
            column.path === "/"
              ? "/" + entry.name
              : column.path + "/" + entry.name;
          showContextMenu(e.clientX, e.clientY, colIndex, entry, fullPath);
        });
      }

      // Drag start
      entryEl.addEventListener("dragstart", (e) => {
        const colPath = column.path;
        // If dragged entry is in selection, drag all selected; otherwise just this one
        let names;
        if (column.selected.has(entry.name)) {
          names = [...column.selected];
        } else {
          names = [entry.name];
        }
        const paths = names.map((n) =>
          colPath === "/" ? "/" + n : colPath + "/" + n,
        );
        state.dragSources = paths;
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", JSON.stringify(paths));
        entryEl.classList.add("dragging");
      });

      entryEl.addEventListener("dragend", () => {
        entryEl.classList.remove("dragging");
        state.dragSources = [];
        // Clean up all drag-over indicators
        document
          .querySelectorAll(".drag-over")
          .forEach((el) => el.classList.remove("drag-over"));
      });

      // Drop target (only folders)
      if (entry.is_dir) {
        entryEl.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          entryEl.classList.add("drag-over");
        });

        entryEl.addEventListener("dragleave", () => {
          entryEl.classList.remove("drag-over");
        });

        entryEl.addEventListener("drop", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          entryEl.classList.remove("drag-over");

          const destDir =
            column.path === "/"
              ? "/" + entry.name
              : column.path + "/" + entry.name;

          await handleDrop(e, destDir);
        });
      }

      colEl.appendChild(entryEl);
    });

    // Click on blank space to deselect
    colEl.addEventListener("click", (e) => {
      if (e.target === colEl) {
        column.selected = new Set();
        column.lastClickedIndex = -1;
        column.selectionCursor = -1;
        state.columns = state.columns.slice(0, colIndex + 1);
        state.focusedColumn = colIndex;
        renderColumns();
        updateBreadcrumb();
        focusColumns();
      }
    });

    // Right-click on blank space for column context menu
    colEl.addEventListener("contextmenu", (e) => {
      if (e.target === colEl && column.path) {
        e.preventDefault();
        showColumnContextMenu(e.clientX, e.clientY, column.path);
      }
    });

    // Column-level drop target: drop into this column's directory
    if (column.path) {
      colEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        colEl.classList.add("drag-over");
      });

      colEl.addEventListener("dragleave", (e) => {
        if (!colEl.contains(e.relatedTarget)) {
          colEl.classList.remove("drag-over");
        }
      });

      colEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        colEl.classList.remove("drag-over");
        await handleDrop(e, column.path);
      });
    }

    container.appendChild(colEl);

    // Resize handle after each column except the last
    if (colIndex < state.columns.length - 1) {
      container.appendChild(createColumnResizeHandle(colIndex, colEl));
    }
  });

  // Restore scroll positions
  const newCols = container.querySelectorAll(":scope > .column");
  newCols.forEach((col, i) => {
    if (i < scrollPositions.length) {
      col.scrollTop = scrollPositions[i];
    }
  });
  restoreEditorState(editorState);
}

function createColumnResizeHandle(colIndex, colEl) {
  const handle = document.createElement("div");
  handle.className = "column-resize-handle";

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colEl.offsetWidth;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent) => {
      const newWidth = Math.max(120, startWidth + (moveEvent.clientX - startX));
      colEl.style.minWidth = newWidth + "px";
      colEl.style.width = newWidth + "px";
      state.columns[colIndex].width = newWidth;
    };

    const onMouseUp = () => {
      handle.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  return handle;
}

async function handleDrop(e, destDir) {
  // Handle file uploads from OS
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const hasPlainText = e.dataTransfer.types.includes("text/plain");
    let isInternal = false;
    if (hasPlainText) {
      try {
        const parsed = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (
          Array.isArray(parsed) ||
          (parsed && parsed.sidebarRemove !== undefined)
        ) {
          isInternal = true;
        }
      } catch {}
    }
    if (!isInternal) {
      await handleFileUpload(e.dataTransfer.files, destDir);
      return;
    }
  }

  let paths;
  try {
    paths = JSON.parse(e.dataTransfer.getData("text/plain"));
  } catch {
    return;
  }
  if (!Array.isArray(paths) || paths.length === 0) return;

  let errors = 0;
  for (const src of paths) {
    const basename = src.split("/").pop();
    const dest = destDir + "/" + basename;
    if (src === dest || src === destDir) continue;
    try {
      const resp = await fetch("/api/move", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ src, dest }),
      });
      if (!resp.ok) errors++;
      else pushUndo({ type: "move", src, dest });
    } catch {
      errors++;
    }
  }

  if (errors > 0) {
    showNotification(`${errors} item(s) failed to move`, "error");
  }

  await refreshColumns();
}

// keepSizes carries known folder sizes over, so only new folders are measured.
async function refreshColumns({ keepSizes = false } = {}) {
  apiCache.invalidateUrl("/api/ls");
  if (!keepSizes) apiCache.invalidateUrl("/api/dir-sizes");
  // Re-fetch all directory columns to reflect moves
  for (let i = 0; i < state.columns.length; i++) {
    const col = state.columns[i];
    if (!col.path || col.fileInfo) continue;
    try {
      const resp = await fetch("/api/ls", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ path: col.path }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (keepSizes) {
          const known = new Map(col.entries.map((e) => [e.name, e.dirSize]));
          for (const entry of data.entries) {
            if (entry.is_dir) entry.dirSize = known.get(entry.name);
          }
        }
        col.entries = data.entries;
        col.mtime = data.mtime;
        // Remove selected entries that no longer exist
        const names = new Set(data.entries.map((e) => e.name));
        for (const name of col.selected) {
          if (!names.has(name)) col.selected.delete(name);
        }
      }
    } catch {
      // keep existing data
    }
  }
  renderColumns();
  updateBreadcrumb();

  // Re-fetch directory sizes
  for (let i = 0; i < state.columns.length; i++) {
    const col = state.columns[i];
    if (col.path && !col.fileInfo && !col.filePreview) {
      col.sizesLoaded = false;
      fetchDirSizes(i);
    }
  }
}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb");
  breadcrumb.innerHTML = "";

  if (state.columns.length === 0) return;

  let currentPath = null;
  for (let i = state.columns.length - 1; i >= 0; i--) {
    if (state.columns[i].path) {
      currentPath = state.columns[i].path;
      break;
    }
  }
  if (!currentPath) return;

  const parts = currentPath.split("/").filter(Boolean);

  // Root
  const rootEl = document.createElement("span");
  rootEl.className = "breadcrumb-item";
  rootEl.textContent = "/";
  rootEl.draggable = true;
  rootEl.addEventListener("click", () => navigateToBreadcrumb("/"));
  rootEl.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", "/");
    e.dataTransfer.setData("x-dir-path", "/");
    e.dataTransfer.effectAllowed = "copyMove";
  });
  breadcrumb.appendChild(rootEl);

  let buildPath = "";
  parts.forEach((part, partIdx) => {
    if (partIdx > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "/";
      breadcrumb.appendChild(sep);
    }

    buildPath += "/" + part;
    const partPath = buildPath;

    const partEl = document.createElement("span");
    partEl.className = "breadcrumb-item";
    partEl.textContent = part;
    partEl.draggable = true;
    partEl.addEventListener("click", () => navigateToBreadcrumb(partPath));
    partEl.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", partPath);
      e.dataTransfer.setData("x-dir-path", partPath);
      e.dataTransfer.effectAllowed = "copyMove";
    });
    breadcrumb.appendChild(partEl);

    // Dropdown chevron for sibling directory navigation
    const parentPath =
      partIdx === 0 ? "/" : "/" + parts.slice(0, partIdx).join("/");
    const chevron = document.createElement("span");
    chevron.className = "breadcrumb-chevron";
    chevron.innerHTML = "&#x25BE;";
    chevron.addEventListener("click", (ev) => {
      ev.stopPropagation();
      showBreadcrumbDropdown(chevron, parentPath, part);
    });
    breadcrumb.appendChild(chevron);
  });

  updatePathBar();
}

function updatePathBar() {
  const pathBar = document.getElementById("path-bar");
  if (!pathBar) return;

  // Find the deepest selected file/folder path
  let displayPath = null;
  for (let i = state.columns.length - 1; i >= 0; i--) {
    const col = state.columns[i];
    if (col.fileInfo) {
      displayPath = col.fileInfo.path;
      break;
    }
    if (col.path && col.selected && col.selected.size === 1) {
      const name = [...col.selected][0];
      displayPath = col.path === "/" ? "/" + name : col.path + "/" + name;
      break;
    }
    if (col.path) {
      displayPath = col.path;
      break;
    }
  }

  if (!displayPath) {
    pathBar.innerHTML = "";
    return;
  }

  const branchHtml = state.gitBranch
    ? `<span class="path-bar-branch">${escapeHtml(state.gitBranch)}</span>`
    : "";
  pathBar.innerHTML = `<span class="path-bar-text"><bdi>${escapeHtml(displayPath)}</bdi></span><button class="path-bar-copy" onclick="copyToClipboard(${jsAttr(displayPath)})" title="Copy path">${COPY_ICON}</button>${branchHtml}`;
}

async function fetchStatInfo(filePath, colIndex) {
  try {
    const resp = await fetch("/api/stat", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: filePath }),
    });
    const data = await resp.json();
    if (data.owner) {
      const col = state.columns[colIndex];
      if (col && col.fileInfo && col.fileInfo.path === filePath) {
        col.fileInfo.owner = data.owner;
        col.fileInfo.group = data.group;
        renderColumns();
      }
    }
  } catch {}
}

async function showFolderInfo(colIndex, entry, fullPath) {
  // Add a folder info column
  state.columns = state.columns.slice(0, colIndex + 1);
  state.columns.push({
    fileInfo: {
      path: fullPath,
      name: entry.name,
      is_dir: true,
      size: entry.size || 0,
      mode: entry.mode || "drwxr-xr-x",
      mtime: entry.mtime || 0,
    },
  });
  renderColumns();

  // Fetch detailed stat info (owner, group)
  try {
    const data = await fetch("/api/stat", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: fullPath }),
    }).then((r) => r.json());
    const col = state.columns[colIndex + 1];
    if (col && col.fileInfo && col.fileInfo.path === fullPath) {
      col.fileInfo.owner = data.owner;
      col.fileInfo.group = data.group;
      col.fileInfo.size = data.size;
      col.fileInfo.mode = data.mode;
      col.fileInfo.mtime = data.mtime;
      renderColumns();
    }
  } catch {}

  // Also fetch git info
  fetchGitInfo(fullPath, colIndex + 1);
}

async function fetchGitInfo(filePath, colIndex) {
  try {
    const data = await cachedPost("/api/git-info", { path: filePath }, 120000);

    // Store author on the fileInfo object and re-render
    if (data.created_by) {
      const col = state.columns[colIndex];
      if (col && col.fileInfo && col.fileInfo.path === filePath) {
        col.fileInfo._gitAuthor = data.created_by;
        renderColumns();
      }
    }

    // Update branch in path bar
    if (data.branch) {
      state.gitBranch = data.branch;
      updatePathBar();
    }
  } catch {
    // silently fail -- not in a git repo
  }
}

async function fetchGitBranch(dirPath) {
  try {
    const data = await cachedPost(
      "/api/git-info",
      { path: dirPath, author: false },
      120000,
    );
    state.gitBranch = data.branch || null;
    updatePathBar();
  } catch {
    state.gitBranch = null;
    updatePathBar();
  }
}

function toggleHiddenFiles() {
  state.showHidden = document.getElementById("hidden-toggle").checked;
  renderColumns();
}

// ── Directory Sizes ─────────────────────────────────────────────────

const dirSizeRequests = new Set();

async function fetchDirSizes(colIndex) {
  const column = state.columns[colIndex];
  if (
    !column ||
    !column.path ||
    column.fileInfo ||
    column.filePreview ||
    column.sizesLoaded
  )
    return;

  const dirNames = column.entries
    .filter((e) => e.is_dir && e.dirSize === undefined)
    .map((e) => e.name);
  if (dirNames.length === 0) return;

  // A slow du must never run twice for one folder: each request holds one of
  // the browser's six connections to the server until it returns.
  const requestKey = state.connectionId + "|" + column.path;
  if (dirSizeRequests.has(requestKey)) return;
  dirSizeRequests.add(requestKey);
  column.sizesLoaded = true;

  try {
    const data = await cachedPost(
      "/api/dir-sizes",
      { path: column.path, names: dirNames },
      60000,
    );
    if (data.sizes) {
      // Verify column still exists
      if (
        colIndex >= state.columns.length ||
        state.columns[colIndex] !== column
      )
        return;

      // null marks a folder that was too slow to measure, so it is not retried.
      const requested = new Set(dirNames);
      for (const entry of column.entries) {
        if (entry.is_dir && requested.has(entry.name)) {
          entry.dirSize = data.sizes[entry.name] ?? null;
        }
      }
      renderColumns();
    }
  } catch {
    // silently fail
  } finally {
    dirSizeRequests.delete(requestKey);
  }
}

// ── Preview ─────────────────────────────────────────────────────────

function togglePreviewWrap() {
  state.previewWrap = !state.previewWrap;
  renderColumns();
}

// ── Chmod ────────────────────────────────────────────────────────────

function parseModeBits(modeStr) {
  // Parse "-rwxrwxrwx" string into an object
  if (!modeStr || modeStr.length < 10) return {};
  return {
    owner: {
      r: modeStr[1] === "r",
      w: modeStr[2] === "w",
      x: "xs".includes(modeStr[3]),
    },
    group: {
      r: modeStr[4] === "r",
      w: modeStr[5] === "w",
      x: "xs".includes(modeStr[6]),
    },
    others: {
      r: modeStr[7] === "r",
      w: modeStr[8] === "w",
      x: "xt".includes(modeStr[9]),
    },
    setuid: "sS".includes(modeStr[3]),
    setgid: "sS".includes(modeStr[6]),
    sticky: "tT".includes(modeStr[9]),
  };
}

function permBitsToOctal(bits) {
  function tripleToOctal(t) {
    return (t.r ? 4 : 0) + (t.w ? 2 : 0) + (t.x ? 1 : 0);
  }
  return (
    (bits.setuid ? 0o4000 : 0) +
    (bits.setgid ? 0o2000 : 0) +
    (bits.sticky ? 0o1000 : 0) +
    tripleToOctal(bits.owner) * 64 +
    tripleToOctal(bits.group) * 8 +
    tripleToOctal(bits.others)
  );
}

function chmodToggle(path, bits, who, perm) {
  const active = bits[who] && bits[who][perm];
  const cls = active ? "chmod-pill active" : "chmod-pill";
  const newVal = active ? "false" : "true";
  return `<button class="${cls}" onclick="handleChmod(${jsAttr(path)}, '${who}', '${perm}', ${newVal})">${perm.toUpperCase()}</button>`;
}

function chmodRow(path, bits, who, label) {
  return `<div class="chmod-row">
    <span class="chmod-who">${label}</span>
    <div class="chmod-pills">
      ${chmodToggle(path, bits, who, "r")}
      ${chmodToggle(path, bits, who, "w")}
      ${chmodToggle(path, bits, who, "x")}
    </div>
  </div>`;
}

async function handleChmod(path, who, perm, value) {
  // Find the info column for this path
  const infoCol = state.columns.find(
    (c) => c.fileInfo && c.fileInfo.path === path,
  );
  if (!infoCol) return;

  // Parse current bits, update the toggled bit
  const bits = parseModeBits(infoCol.fileInfo.mode);
  if (!bits.owner) return;
  bits[who][perm] = value;
  const octal = permBitsToOctal(bits);

  try {
    const resp = await fetch("/api/chmod", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path, mode: octal }),
    });
    const data = await resp.json();
    if (data.mode) {
      infoCol.fileInfo.mode = data.mode;
    } else if (data.error) {
      showNotification(data.error, "error");
    }
  } catch (e) {
    showNotification("chmod failed: " + e.message, "error");
  }

  renderColumns();
}

// ── Rename ───────────────────────────────────────────────────────────

function startRename(colIndex, name) {
  state.renaming = { colIndex, name };
  renderColumns();

  // Focus the rename input
  const input = document.getElementById("rename-input");
  if (input) {
    input.focus();
    // Select name without extension for files
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
      input.setSelectionRange(0, dot);
    } else {
      input.select();
    }
  }
}

function cancelRename() {
  state.renaming = null;
  renderColumns();
  focusColumns();
}

async function commitRename(colIndex, oldName, newName) {
  state.renaming = null;

  if (!newName || newName === oldName) {
    renderColumns();
    focusColumns();
    return;
  }
  if (newName.includes("/")) {
    showNotification("Names cannot contain /", "error");
    renderColumns();
    return;
  }

  const column = state.columns[colIndex];
  if (!column || !column.path) return;

  const oldPath =
    column.path === "/" ? "/" + oldName : column.path + "/" + oldName;
  const newPath =
    column.path === "/" ? "/" + newName : column.path + "/" + newName;

  try {
    const resp = await fetch("/api/move", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ src: oldPath, dest: newPath }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showNotification(err.error || "Rename failed", "error");
    } else {
      pushUndo({ type: "rename", src: oldPath, dest: newPath });
    }
  } catch (e) {
    showNotification("Rename failed: " + e.message, "error");
  }

  await refreshColumns();
  focusColumns();
}

// ── Back/Forward Navigation ───────────────────────────────────────────

function pushHistory(path) {
  // Truncate any forward history
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  state.history.push(path);
  if (state.history.length > 50) state.history.shift();
  state.historyIndex = state.history.length - 1;
}

function navigateBack() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  state.historyPaused = true;
  navigateTo(state.history[state.historyIndex]).then(() => {
    state.historyPaused = false;
    updateNavButtons();
  });
}

function navigateForward() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  state.historyPaused = true;
  navigateTo(state.history[state.historyIndex]).then(() => {
    state.historyPaused = false;
    updateNavButtons();
  });
}

function updateNavButtons() {
  const back = document.getElementById("nav-back");
  const fwd = document.getElementById("nav-forward");
  if (back) back.disabled = state.historyIndex <= 0;
  if (fwd) fwd.disabled = state.historyIndex >= state.history.length - 1;
}

// ── Column Width Persistence ─────────────────────────────────────────

function getDefaultColumnWidth() {
  return parseInt(localStorage.getItem("defaultColumnWidth") || "240", 10);
}

function setDefaultColumnWidth(w) {
  localStorage.setItem("defaultColumnWidth", String(Math.round(w)));
}

// ── File Watcher ─────────────────────────────────────────────────────

function startFileWatcher() {
  if (state.fileWatcher) return;
  state.fileWatcher = setInterval(pollFileChanges, 5000);
}

function stopFileWatcher() {
  if (state.fileWatcher) {
    clearInterval(state.fileWatcher);
    state.fileWatcher = null;
  }
}

async function pollFileChanges() {
  if (!state.connected || state.columns.length === 0) return;
  if (document.hidden || state.renaming || state.dragSources.length > 0) return;
  const paths = [];
  for (const col of state.columns) {
    if (!col.path || col.fileInfo || col.filePreview || col.loading) continue;
    if (col.mtime === undefined) continue;
    paths.push({ path: col.path, mtime: col.mtime });
  }
  if (paths.length === 0) return;
  try {
    const data = await cachedPost("/api/check-modified", { paths }, 0);
    if (data.changed && data.changed.length > 0) {
      await refreshColumns({ keepSizes: true });
    }
  } catch {}
}

// ── Drag Selection Rectangle ─────────────────────────────────────────

function setupDragSelection() {
  let startX, startY, rect, colEl, colIndex;
  const container = document.getElementById("columns");
  if (!container) return;

  container.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    // Only start if clicking on column blank space
    const target = e.target;
    if (!target.classList.contains("column") || target.closest(".column-entry"))
      return;
    colEl = target;
    colIndex = [...container.querySelectorAll(":scope > .column")].indexOf(
      colEl,
    );
    if (colIndex < 0 || colIndex >= state.columns.length) return;
    startX = e.clientX;
    startY = e.clientY;
    rect = null;

    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      if (!rect && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!rect) {
        rect = document.createElement("div");
        rect.className = "selection-rect";
        document.body.appendChild(rect);
      }
      const x = Math.min(startX, e2.clientX);
      const y = Math.min(startY, e2.clientY);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      rect.style.left = x + "px";
      rect.style.top = y + "px";
      rect.style.width = w + "px";
      rect.style.height = h + "px";

      // Select entries that intersect the rectangle
      const selRect = { left: x, top: y, right: x + w, bottom: y + h };
      const col = state.columns[colIndex];
      if (!col) return;
      col.selected = new Set();
      const entries = getVisibleEntries(col);
      colEl.querySelectorAll(".column-entry").forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (
          r.bottom > selRect.top &&
          r.top < selRect.bottom &&
          r.right > selRect.left &&
          r.left < selRect.right
        ) {
          if (entries[i]) col.selected.add(entries[i].name);
          el.classList.add("selected");
        } else {
          el.classList.remove("selected");
        }
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (rect) {
        rect.remove();
        renderColumns();
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}
