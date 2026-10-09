// ── Context Menu ─────────────────────────────────────────────────────

function showColumnContextMenu(x, y, dirPath) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const newFolderItem = document.createElement("div");
  newFolderItem.className = "context-menu-item";
  newFolderItem.innerHTML = `<span class="ctx-icon">${CTX.newFolder}</span><span>New Folder</span>`;
  newFolderItem.addEventListener("click", () => {
    hideContextMenu();
    createEntry(dirPath, "folder");
  });
  menu.appendChild(newFolderItem);

  const newFileItem = document.createElement("div");
  newFileItem.className = "context-menu-item";
  newFileItem.innerHTML = `<span class="ctx-icon">${CTX.copyName}</span><span>New File</span>`;
  newFileItem.addEventListener("click", () => {
    hideContextMenu();
    createEntry(dirPath, "file");
  });
  menu.appendChild(newFileItem);

  const uploadItem = document.createElement("div");
  uploadItem.className = "context-menu-item";
  uploadItem.innerHTML = `<span class="ctx-icon">${CTX.upload}</span><span>Upload Files</span>`;
  uploadItem.addEventListener("click", () => {
    hideContextMenu();
    triggerUpload(dirPath);
  });
  menu.appendChild(uploadItem);

  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth)
    x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight)
    y = window.innerHeight - rect.height - 8;
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  registerContextMenuDismiss();
}

async function createEntry(dirPath, kind) {
  const name = prompt(`New ${kind} name:`);
  if (!name) return;
  if (name.includes("/")) {
    showNotification("Names cannot contain /", "error");
    return;
  }

  const fullPath = dirPath === "/" ? "/" + name : dirPath + "/" + name;

  try {
    const resp = await fetch(kind === "folder" ? "/api/mkdir" : "/api/new-file", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: fullPath }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification(data.error, "error");
    } else {
      showNotification("Created " + name, "success");
    }
  } catch (e) {
    showNotification("Failed: " + e.message, "error");
  }

  await refreshColumns();
}

function showContextMenu(x, y, colIndex, entry, fullPath) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const column = state.columns[colIndex];
  const selectedCount = column ? column.selected.size : 1;
  const isMulti = selectedCount > 1;

  const shortcuts = getSidebarShortcuts(state.host);
  const isFavorited = shortcuts.some((s) => s.path === fullPath);

  const items = [];

  if (isMulti) {
    if (selectedCount === 2) {
      const names = [...column.selected];
      const paths = names.map((n) =>
        column.path === "/" ? "/" + n : column.path + "/" + n,
      );
      const allFiles = names.every((n) => {
        const e = column.entries.find((x) => x.name === n);
        return e && !e.is_dir;
      });
      if (allFiles) {
        items.push({
          icon: CTX.copyPath,
          label: "Compare Files",
          action: () => showDiffView(paths[0], paths[1]),
        });
      }
    }
    items.push({
      icon: CTX.rename,
      label: "Batch Rename...",
      action: () => showBatchRenameDialog(colIndex),
    });
    items.push({ separator: true });
    items.push({
      icon: CTX.trash,
      label: `Delete ${selectedCount} items`,
      action: () => confirmDeleteMulti(colIndex),
      danger: true,
    });
  } else {
    items.push(
      {
        icon: CTX.copyName,
        label: "Copy Name",
        action: () => copyToClipboard(entry.name),
      },
      {
        icon: CTX.copyPath,
        label: "Copy Path",
        action: () => copyToClipboard(fullPath),
      },
    );
    if (!entry.is_dir) {
      items.push({
        icon: CTX.download,
        label: "Download",
        action: () => downloadFile(fullPath),
      });
    }
    if (entry.is_dir) {
      items.push(
        {
          icon: CTX.download,
          label: "Download as .tar.gz",
          action: () => downloadFile(fullPath),
        },
        {
          icon: CTX.copyName,
          label: "Get Info",
          action: () => showFolderInfo(colIndex, entry, fullPath),
        },
      );
    }
    items.push(
      { separator: true },
      {
        icon: isFavorited ? CTX.starEmpty : CTX.starFill,
        label: isFavorited ? "Remove from Favorites" : "Add to Favorites",
        action: () => {
          const current = getSidebarShortcuts(state.host);
          if (isFavorited) {
            const idx = current.findIndex((s) => s.path === fullPath);
            if (idx >= 0) current.splice(idx, 1);
          } else {
            current.push({ path: fullPath, name: entry.name });
          }
          saveSidebarShortcuts(state.host, current);
          renderSidebar();
        },
      },
      {
        icon: CTX.duplicate,
        label: "Duplicate",
        action: () => duplicateEntry(colIndex, entry, fullPath),
      },
      {
        icon: CTX.rename,
        label: "Rename",
        action: () => startRename(colIndex, entry.name),
      },
      {
        icon: CTX.xmark,
        label: "Run Command...",
        action: () => showCustomCommandDialog([fullPath], column.path),
      },
      { separator: true },
      {
        icon: CTX.trash,
        label: "Delete",
        action: () => confirmDelete(colIndex, entry, fullPath),
        danger: true,
      },
    );
  }

  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement("div");
    el.className = "context-menu-item" + (item.danger ? " danger" : "");
    if (item.icon) {
      el.innerHTML = `<span class="ctx-icon">${item.icon}</span><span>${escapeHtml(item.label)}</span>`;
    } else {
      el.textContent = item.label;
    }
    el.addEventListener("click", () => {
      hideContextMenu();
      item.action();
    });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);

  // Position: keep on screen
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth)
    x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight)
    y = window.innerHeight - rect.height - 8;
  menu.style.left = x + "px";
  menu.style.top = y + "px";

  registerContextMenuDismiss();
}

let _ctxClickHandler = null;
let _ctxContextHandler = null;

function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.remove();
  document.removeEventListener("keydown", handleContextMenuKey);
  if (_ctxClickHandler) {
    document.removeEventListener("click", _ctxClickHandler);
    _ctxClickHandler = null;
  }
  if (_ctxContextHandler) {
    document.removeEventListener("contextmenu", _ctxContextHandler);
    _ctxContextHandler = null;
  }
}

function registerContextMenuDismiss() {
  _ctxClickHandler = () => hideContextMenu();
  _ctxContextHandler = () => hideContextMenu();
  setTimeout(() => {
    document.addEventListener("click", _ctxClickHandler, { once: true });
    document.addEventListener("contextmenu", _ctxContextHandler, {
      once: true,
    });
  }, 0);
  document.addEventListener("keydown", handleContextMenuKey);
}

function handleContextMenuKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    hideContextMenu();
  }
}

async function duplicateEntry(colIndex, entry, fullPath) {
  try {
    const resp = await fetch("/api/duplicate", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: fullPath, is_dir: entry.is_dir }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification(data.error, "error");
    } else {
      showNotification("Duplicated " + entry.name, "success");
    }
  } catch (e) {
    showNotification("Duplicate failed: " + e.message, "error");
  }
  await refreshColumns();
}

async function confirmDelete(colIndex, entry, fullPath) {
  const name = entry.name;
  const what = entry.is_dir ? "folder" : "file";
  if (!confirm(`Delete ${what} "${name}"?`)) return;

  try {
    const resp = await fetch("/api/delete", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path: fullPath, is_dir: entry.is_dir }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification(data.error, "error");
    } else {
      showNotification(`Deleted ${name}`, "success");
    }
  } catch (e) {
    showNotification("Delete failed: " + e.message, "error");
  }

  await refreshColumns();
}

async function confirmDeleteMulti(colIndex) {
  const column = state.columns[colIndex];
  if (!column) return;
  const names = [...column.selected];
  if (!confirm(`Delete ${names.length} items?`)) return;

  let errors = 0;
  for (const name of names) {
    const entry = column.entries.find((e) => e.name === name);
    if (!entry) continue;
    const fullPath =
      column.path === "/" ? "/" + name : column.path + "/" + name;
    try {
      const resp = await fetch("/api/delete", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ path: fullPath, is_dir: entry.is_dir }),
      });
      const data = await resp.json();
      if (data.error) errors++;
    } catch {
      errors++;
    }
  }

  if (errors > 0) {
    showNotification(`${errors} item(s) failed to delete`, "error");
  } else {
    showNotification(`Deleted ${names.length} items`, "success");
  }
  await refreshColumns();
}

function downloadFile(path) {
  const params = new URLSearchParams({
    path,
    connection_id: state.connectionId,
  });
  const a = document.createElement("a");
  a.href = "/api/download?" + params;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Breadcrumb Dropdown ──────────────────────────────────────────────

async function showBreadcrumbDropdown(segmentEl, parentPath, currentName) {
  hideContextMenu();
  try {
    const data = await cachedPost("/api/ls", { path: parentPath }, 30000);
    if (data.error) return;
    const dirs = data.entries
      .filter((e) => e.is_dir)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (dirs.length === 0) return;

    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.id = "context-menu";
    menu.style.maxHeight = "300px";
    menu.style.overflowY = "auto";

    dirs.forEach((d) => {
      const el = document.createElement("div");
      el.className =
        "context-menu-item" + (d.name === currentName ? " active" : "");
      el.innerHTML = `<span class="ctx-icon">${FOLDER_ICON.replace('width="16"', 'width="14"').replace('height="16"', 'height="14"')}</span><span>${escapeHtml(d.name)}</span>`;
      el.addEventListener("click", () => {
        hideContextMenu();
        const newPath =
          parentPath === "/" ? "/" + d.name : parentPath + "/" + d.name;
        navigateTo(newPath);
      });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    const rect = segmentEl.getBoundingClientRect();
    menu.style.left = rect.left + "px";
    menu.style.top = rect.bottom + 2 + "px";
    if (rect.left + menu.offsetWidth > window.innerWidth) {
      menu.style.left = window.innerWidth - menu.offsetWidth - 8 + "px";
    }
    registerContextMenuDismiss();
  } catch {}
}
