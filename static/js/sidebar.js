// ── Sidebar Shortcuts ────────────────────────────────────────────────

function getSidebarShortcuts(host) {
  try {
    return JSON.parse(localStorage.getItem("shortcuts:" + host) || "[]");
  } catch {
    return [];
  }
}

function saveSidebarShortcuts(host, shortcuts) {
  localStorage.setItem("shortcuts:" + host, JSON.stringify(shortcuts));
}

function seedSidebarIfNew() {
  const key = "shortcuts:" + state.host;
  // Only seed if this host has never had shortcuts set (null, not "[]")
  if (localStorage.getItem(key) === null) {
    const homeName = "~" + (state.homeDir.split("/").pop() || "");
    saveSidebarShortcuts(state.host, [
      { path: "/", name: "/" },
      { path: state.homeDir, name: homeName },
      { path: "/data", name: "data" },
    ]);
  }
}

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar || !state.connected) return;
  sidebar.innerHTML = "";

  const section = document.createElement("div");
  section.className = "sidebar-section";

  const label = document.createElement("div");
  label.className = "sidebar-label";
  label.textContent = "Favorites";
  section.appendChild(label);

  // Shortcuts (including home as a regular favorite)
  const shortcuts = getSidebarShortcuts(state.host);
  shortcuts.forEach((shortcut, idx) => {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    item.draggable = true;
    const name = shortcut.name || shortcut.path.split("/").pop() || "/";
    item.innerHTML = `<span class="sidebar-icon">${FOLDER_ICON}</span><span class="sidebar-name">${escapeHtml(name)}</span>`;
    item.title = shortcut.path;
    // Highlight if current browsing path starts with this shortcut
    const rootPath = state.columns.length > 0 ? state.columns[0].path : "";
    if (
      rootPath === shortcut.path ||
      rootPath.startsWith(shortcut.path + "/")
    ) {
      item.classList.add("active");
    }

    item.addEventListener("click", () => {
      navigateTo(shortcut.path).then(() => focusColumns());
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showSidebarContextMenu(e.clientX, e.clientY, idx);
    });

    // Drag to reorder or drag out to remove
    item.dataset.idx = idx;
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ sidebarRemove: idx }),
      );
      item.classList.add("dragging");
      sidebar._dragIdx = idx;
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // Show drop indicator
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      item.classList.toggle("drop-above", e.clientY < midY);
      item.classList.toggle("drop-below", e.clientY >= midY);
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-above", "drop-below");
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove("drop-above", "drop-below");
      const fromIdx = sidebar._dragIdx;
      if (fromIdx === undefined || fromIdx === idx) return;
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      let toIdx = e.clientY < midY ? idx : idx + 1;
      // Adjust for removal shift
      if (fromIdx < toIdx) toIdx--;
      if (fromIdx === toIdx) return;
      const current = getSidebarShortcuts(state.host);
      const [moved] = current.splice(fromIdx, 1);
      current.splice(toIdx, 0, moved);
      saveSidebarShortcuts(state.host, current);
      sidebar._dragIdx = undefined;
      sidebar._reorderDone = true;
      renderSidebar();
    });
    item.addEventListener("dragend", (e) => {
      item.classList.remove("dragging");
      sidebar._dragIdx = undefined;
      // If a reorder just happened, don't remove
      if (sidebar._reorderDone) {
        sidebar._reorderDone = false;
        return;
      }
      // If dropped outside the sidebar, remove it
      const rect = sidebar.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        const current = getSidebarShortcuts(state.host);
        current.splice(idx, 1);
        saveSidebarShortcuts(state.host, current);
        renderSidebar();
      }
    });

    section.appendChild(item);
  });

  sidebar.appendChild(section);

  // Set up drag-and-drop listeners once (avoid stacking on re-renders)
  if (!sidebar._sidebarDragSetup) {
    sidebar._sidebarDragSetup = true;

    sidebar.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      sidebar.classList.add("drag-over");
    });

    sidebar.addEventListener("dragleave", (e) => {
      if (!sidebar.contains(e.relatedTarget)) {
        sidebar.classList.remove("drag-over");
      }
    });

    sidebar.addEventListener("drop", (e) => {
      e.preventDefault();
      sidebar.classList.remove("drag-over");

      // Breadcrumb drags use x-dir-path
      const dirPath = e.dataTransfer.getData("x-dir-path");
      if (dirPath) {
        const shortcuts = getSidebarShortcuts(state.host);
        if (!shortcuts.some((s) => s.path === dirPath)) {
          shortcuts.push({
            path: dirPath,
            name: dirPath.split("/").pop() || "/",
          });
          saveSidebarShortcuts(state.host, shortcuts);
          renderSidebar();
          showNotification("Added shortcut", "success");
        }
        return;
      }

      // Column entry drags use JSON array in text/plain
      let paths;
      try {
        const raw = JSON.parse(e.dataTransfer.getData("text/plain"));
        // Sidebar-item dropped within sidebar -- not a removal
        if (raw && raw.sidebarRemove !== undefined) {
          sidebar._reorderDone = true;
          return;
        }
        paths = raw;
      } catch {
        return;
      }
      if (!Array.isArray(paths)) return;

      const shortcuts = getSidebarShortcuts(state.host);
      let added = 0;
      for (const p of paths) {
        // Only add directories (check if path is in a directory column)
        const isDir = state.columns.some(
          (col) =>
            col.path &&
            col.entries &&
            col.entries.some(
              (ent) =>
                ent.is_dir &&
                (col.path === "/"
                  ? "/" + ent.name
                  : col.path + "/" + ent.name) === p,
            ),
        );
        if (isDir && !shortcuts.some((s) => s.path === p)) {
          shortcuts.push({ path: p, name: p.split("/").pop() || "/" });
          added++;
        }
      }
      if (added > 0) {
        saveSidebarShortcuts(state.host, shortcuts);
        renderSidebar();
        showNotification(`Added ${added} shortcut(s)`, "success");
      }
    });
  }
}

function showSidebarContextMenu(x, y, shortcutIndex) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const removeItem = document.createElement("div");
  removeItem.className = "context-menu-item danger";
  removeItem.innerHTML = `<span class="ctx-icon">${CTX.starEmpty}</span><span>Remove from Favorites</span>`;
  removeItem.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideContextMenu();
    const shortcuts = getSidebarShortcuts(state.host);
    shortcuts.splice(shortcutIndex, 1);
    saveSidebarShortcuts(state.host, shortcuts);
    renderSidebar();
  });
  menu.appendChild(removeItem);

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
