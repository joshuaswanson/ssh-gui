// ── State ────────────────────────────────────────────────────────────

const state = {
  connected: false,
  host: "",
  username: "",
  homeDir: "",
  columns: [],
  focusedColumn: 0,
  terminal: null,
  fitAddon: null,
  socket: null,
  showHidden: false,
  isResizing: false,
  sortMode: "name",
  sortAsc: true,
  dragSources: [],
  renaming: null, // { colIndex, name } when inline rename is active
  previewWrap: false,
};

let selectGeneration = 0;

// ── Icons ────────────────────────────────────────────────────────────

const FOLDER_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="#58a6ff">
  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"/>
</svg>`;

const FILE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="#8b949e">
  <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06zM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V1.75z"/>
</svg>`;

const FILE_ICON_LARGE = `<svg width="48" height="48" viewBox="0 0 16 16" fill="#58a6ff" opacity="0.5">
  <path d="M3.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V6H9.75A1.75 1.75 0 0 1 8 4.25V1.5H3.75zm5.75.56v2.19c0 .138.112.25.25.25h2.19L9.5 2.06zM2 1.75C2 .784 2.784 0 3.75 0h5.086c.464 0 .909.184 1.237.513l3.414 3.414c.329.328.513.773.513 1.237v8.086A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25V1.75z"/>
</svg>`;

const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
</svg>`;

// ── Initialization ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadSSHConfigs();
  setupResizeHandle();
  setupKeyboardNavigation();
  window.addEventListener("resize", handleWindowResize);
}

// ── SSH Config ───────────────────────────────────────────────────────

async function loadSSHConfigs() {
  try {
    const response = await fetch("/api/ssh-configs");
    const data = await response.json();

    const starredContainer = document.getElementById("starred-hosts");
    const container = document.getElementById("saved-hosts");
    const defaultUser = data.default_user;

    document.getElementById("user-input").value = defaultUser;

    if (data.hosts.length === 0) {
      starredContainer.innerHTML = "";
      container.innerHTML =
        '<p class="column-empty">No saved SSH hosts found in ~/.ssh/config</p>';
      return;
    }

    const starred = getStarredHosts();
    const starredList = data.hosts
      .filter((h) => starred.has(h.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const unstarredList = data.hosts
      .filter((h) => !starred.has(h.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    function renderHostCard(host, isStarred) {
      const card = document.createElement("div");
      card.className = "host-card";
      card.innerHTML = `
                <div class="host-card-content">
                    <div class="host-alias">${escapeHtml(host.name)}</div>
                    <div class="host-detail">${escapeHtml(host.user || defaultUser)}@${escapeHtml(host.hostname)}</div>
                </div>
                <button class="host-star${isStarred ? " starred" : ""}" title="${isStarred ? "Unstar" : "Star"}">&#9733;</button>
            `;
      card
        .querySelector(".host-card-content")
        .addEventListener("click", () => connectToHost(host));
      card.querySelector(".host-star").addEventListener("click", (e) => {
        e.stopPropagation();
        animateStarToggle(card, host.name);
      });
      return card;
    }

    starredContainer.innerHTML = "";
    if (starredList.length > 0) {
      const label = document.createElement("div");
      label.className = "panel-title";
      label.textContent = "Starred";
      starredContainer.appendChild(label);
      const list = document.createElement("div");
      list.className = "starred-hosts-list";
      starredList.forEach((host) =>
        list.appendChild(renderHostCard(host, true)),
      );
      starredContainer.appendChild(list);
    }

    container.innerHTML = "";
    unstarredList.forEach((host) =>
      container.appendChild(renderHostCard(host, false)),
    );
  } catch (e) {
    console.error("Failed to load SSH configs:", e);
  }
}

function getStarredHosts() {
  try {
    return new Set(JSON.parse(localStorage.getItem("starredHosts") || "[]"));
  } catch {
    return new Set();
  }
}

function toggleStarHost(name) {
  const starred = getStarredHosts();
  if (starred.has(name)) {
    starred.delete(name);
  } else {
    starred.add(name);
  }
  localStorage.setItem("starredHosts", JSON.stringify([...starred]));
}

async function animateStarToggle(card, hostName) {
  const starredEl = document.getElementById("starred-hosts");
  const savedEl = document.getElementById("saved-hosts");
  const oldStarredH = starredEl.offsetHeight;
  const oldSavedH = savedEl.offsetHeight;

  // Fade out the card
  card.style.transition = "opacity 0.15s ease, transform 0.15s ease";
  card.style.opacity = "0";
  card.style.transform = "scale(0.95)";
  await new Promise((r) => setTimeout(r, 150));

  toggleStarHost(hostName);

  // Lock both containers at their current heights
  starredEl.style.height = oldStarredH + "px";
  starredEl.style.overflow = "hidden";
  savedEl.style.maxHeight = "none";
  savedEl.style.height = oldSavedH + "px";
  savedEl.style.overflow = "hidden";
  savedEl.style.maskImage = "none";
  savedEl.style.webkitMaskImage = "none";

  await loadSSHConfigs();

  // Measure new natural heights
  starredEl.style.height = "auto";
  const newStarredH = starredEl.offsetHeight;
  starredEl.style.height = oldStarredH + "px";

  savedEl.style.height = "auto";
  savedEl.style.maxHeight = "";
  const newSavedH = savedEl.offsetHeight;
  savedEl.style.height = oldSavedH + "px";
  savedEl.style.maxHeight = "none";

  // Force reflow
  void starredEl.offsetHeight;

  // Animate to new heights
  starredEl.style.transition = "height 0.3s ease";
  savedEl.style.transition = "height 0.3s ease";
  starredEl.style.height = newStarredH + "px";
  savedEl.style.height = newSavedH + "px";

  setTimeout(() => {
    starredEl.style.height = "";
    starredEl.style.overflow = "";
    starredEl.style.transition = "";
    savedEl.style.height = "";
    savedEl.style.overflow = "";
    savedEl.style.maxHeight = "";
    savedEl.style.transition = "";
    savedEl.style.maskImage = "";
    savedEl.style.webkitMaskImage = "";
  }, 310);
}

// ── Connection ───────────────────────────────────────────────────────

async function connectToHost(host) {
  document
    .querySelectorAll(".host-card")
    .forEach((c) => (c.style.opacity = "0.5"));

  try {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config_host: host.name,
        hostname: host.hostname,
        username: host.user,
        port: host.port,
        key_file: host.identity_file,
      }),
    });

    const data = await response.json();

    if (data.status === "connected") {
      onConnected(data);
    } else {
      showNotification(data.message || "Connection failed", "error");
    }
  } catch (e) {
    showNotification("Connection failed: " + e.message, "error");
  } finally {
    document
      .querySelectorAll(".host-card")
      .forEach((c) => (c.style.opacity = ""));
  }
}

async function handleManualConnect(event) {
  event.preventDefault();

  const hostname = document.getElementById("host-input").value;
  const username = document.getElementById("user-input").value;
  const password = document.getElementById("pass-input").value;
  const port = document.getElementById("port-input").value || "22";
  const keyFile = document.getElementById("key-input").value;

  const btn = document.getElementById("connect-btn");
  btn.disabled = true;
  btn.textContent = "Connecting...";

  try {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostname,
        username,
        password,
        port: parseInt(port),
        key_file: keyFile,
      }),
    });

    const data = await response.json();

    if (data.status === "connected") {
      onConnected(data);
    } else {
      showNotification(data.message || "Connection failed", "error");
    }
  } catch (e) {
    showNotification("Connection failed: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect";
  }
}

async function handleSaveAndConnect() {
  const alias = document.getElementById("alias-input").value.trim();
  const hostname = document.getElementById("host-input").value.trim();
  const username = document.getElementById("user-input").value.trim();
  const port = document.getElementById("port-input").value || "22";
  const keyFile = document.getElementById("key-input").value.trim();

  if (!alias) {
    showNotification("Enter a name to save this host", "error");
    document.getElementById("alias-input").focus();
    return;
  }
  if (!hostname) {
    showNotification("Hostname is required", "error");
    return;
  }

  try {
    const saveResp = await fetch("/api/save-host", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alias,
        hostname,
        username,
        port: parseInt(port),
        key_file: keyFile,
      }),
    });
    const saveData = await saveResp.json();
    if (saveData.error) {
      showNotification(saveData.error, "error");
      return;
    }
    showNotification(`Saved "${alias}" to ~/.ssh/config`, "success");
  } catch (e) {
    showNotification("Failed to save: " + e.message, "error");
    return;
  }

  // Now connect
  document
    .getElementById("connect-form")
    .dispatchEvent(new Event("submit", { cancelable: true }));
}

function onConnected(data) {
  state.connected = true;
  state.host = data.host;
  state.username = data.username;
  state.homeDir = data.home_dir;

  document.getElementById("connection-info").textContent =
    `${data.username}@${data.host}`;

  showScreen("main");
  navigateTo(data.home_dir);
  initTerminal();
}

async function handleDisconnect() {
  try {
    await fetch("/api/disconnect", { method: "POST" });
  } catch (_) {
    // ignore
  }

  state.connected = false;
  state.columns = [];
  state.focusedColumn = 0;

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (state.terminal) {
    state.terminal.dispose();
    state.terminal = null;
    state.fitAddon = null;
  }

  showScreen("connect");
}

// ── File Browser ─────────────────────────────────────────────────────

async function navigateTo(path) {
  try {
    const response = await fetch("/api/ls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      const err = await response.json();
      showNotification(err.error || "Failed to list directory", "error");
      return;
    }

    const data = await response.json();
    state.columns = [
      {
        path: data.path,
        entries: data.entries,
        selected: new Set(),
        lastClickedIndex: -1,
        selectionCursor: -1,
      },
    ];
    state.focusedColumn = 0;
    renderColumns();
    updateBreadcrumb();
    fetchDirSizes(0);
  } catch (e) {
    showNotification("Failed to browse: " + e.message, "error");
  }
}

function navigateToBreadcrumb(path) {
  // Check if this path exists in the current columns
  const colIndex = state.columns.findIndex((c) => c.path === path);
  if (colIndex >= 0) {
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

    // Render immediately to show selection before fetch completes
    state.focusedColumn = colIndex;
    renderColumns();

    try {
      const response = await fetch("/api/ls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath }),
      });

      if (gen !== selectGeneration) return; // stale

      if (response.ok) {
        const data = await response.json();
        // Re-truncate in case state changed during await
        state.columns = state.columns.slice(0, colIndex + 1);
        state.columns.push({
          path: data.path,
          entries: data.entries,
          selected: new Set(),
          lastClickedIndex: -1,
          selectionCursor: -1,
        });
        fetchDirSizes(state.columns.length - 1);
      } else {
        const err = await response.json();
        state.columns = state.columns.slice(0, colIndex + 1);
        state.columns.push({
          path: newPath,
          entries: [],
          selected: new Set(),
          lastClickedIndex: -1,
          selectionCursor: -1,
          error: err.error,
        });
      }
    } catch (e) {
      if (gen !== selectGeneration) return;
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
    const maxPreviewSize = isImage ? 5 * 1024 * 1024 : 1024 * 1024;
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
      headers: { "Content-Type": "application/json" },
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
    } else if (data.image) {
      previewCol.filePreview.image = true;
      previewCol.filePreview.imageData = data.data;
      previewCol.filePreview.imageMime = data.mime;
    } else if (data.binary) {
      previewCol.filePreview.binary = true;
    } else {
      previewCol.filePreview.content = data.content;
      previewCol.filePreview.truncated = data.truncated;
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
    default: {
      // "name" -- folders first, then alpha
      sorted.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
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

function changeSort() {
  const select = document.getElementById("sort-select");
  state.sortMode = select.value;
  renderColumns();
  updateSortDirIcon();
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

  // Save scroll positions before destroying DOM
  const scrollPositions = [];
  container.querySelectorAll(":scope > .column").forEach((col) => {
    scrollPositions.push(col.scrollTop);
  });

  container.innerHTML = "";

  state.columns.forEach((column, colIndex) => {
    const colEl = document.createElement("div");

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
      } else if (preview.image) {
        bodyHtml = `<div class="file-preview-image"><img src="data:${preview.imageMime};base64,${preview.imageData}" /></div>`;
      } else if (preview.binary) {
        bodyHtml =
          '<div class="file-preview-message">Binary file -- cannot preview</div>';
      } else if (preview.content != null) {
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
      } else {
        bodyHtml =
          '<div class="file-preview-message">No preview available</div>';
      }

      const wrapBtnClass = state.previewWrap ? " active" : "";
      const wrapTitle = state.previewWrap
        ? "Scroll horizontally"
        : "Wrap lines";
      colEl.innerHTML = `
                <div class="file-preview-header">
                    <span class="file-preview-title">${escapeHtml(preview.name)}</span>
                    <div class="file-preview-actions">
                        <button class="btn btn-icon preview-wrap-btn${wrapBtnClass}" onclick="togglePreviewWrap()" title="${wrapTitle}">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M1.75 2a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75zm0 5a.75.75 0 0 0 0 1.5h7.5c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25H8.5v-.75a.75.75 0 0 0-1.28-.53l-1.5 1.5a.75.75 0 0 0 0 1.06l1.5 1.5A.75.75 0 0 0 8.5 13v-.75h.75a2.75 2.75 0 0 0 0-5.5h-7.5zM1.75 14a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75z"/>
                            </svg>
                        </button>
                        <span class="file-preview-readonly">Read-only</span>
                    </div>
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

      colEl.innerHTML = `
                <div class="file-info-header">
                    <div class="file-info-icon">${FILE_ICON_LARGE}</div>
                    <div class="file-info-name">${escapeHtml(info.name)} <span class="copy-icon" onclick="copyToClipboard('${escapeAttr(info.name)}')" title="Copy name">${COPY_ICON}</span></div>
                    ${info.is_link ? '<div class="file-info-badge">Symlink</div>' : ""}
                </div>
                <div class="file-info-details">
                    <div class="file-info-section">
                        <div class="file-info-section-title">General</div>
                        <div class="file-info-row">
                            <span class="label">Size</span>
                            <span class="value">${formatSize(info.size)}</span>
                        </div>
                        <div class="file-info-row">
                            <span class="label">Modified</span>
                            <span class="value">${formatDate(info.mtime)}</span>
                        </div>
                        <div class="file-info-row">
                            <span class="label">Path</span>
                            <span class="value value-path">${escapeHtml(info.path)} <span class="copy-icon" onclick="copyToClipboard('${escapeAttr(info.path)}')" title="Copy path">${COPY_ICON}</span></span>
                        </div>
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

    entries.forEach((entry) => {
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
          entry.dirSize !== undefined ? formatSize(entry.dirSize) : "--";
        rightContent = `<span class="entry-size">${dirSizeStr}</span><span class="entry-chevron">&#x203A;</span>`;
      } else {
        rightContent = `<span class="entry-size">${formatSize(entry.size)}</span>`;
      }

      if (isRenaming) {
        entryEl.innerHTML = `
                  <span class="entry-icon">${icon}</span>
                  <input id="rename-input" class="rename-input" type="text" value="${escapeAttr(entry.name)}" />
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
        e.dataTransfer.effectAllowed = "move";
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src, dest }),
      });
      if (!resp.ok) errors++;
    } catch {
      errors++;
    }
  }

  if (errors > 0) {
    showNotification(`${errors} item(s) failed to move`, "error");
  }

  await refreshColumns();
}

async function refreshColumns() {
  // Re-fetch all directory columns to reflect moves
  for (let i = 0; i < state.columns.length; i++) {
    const col = state.columns[i];
    if (!col.path || col.fileInfo) continue;
    try {
      const resp = await fetch("/api/ls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: col.path }),
      });
      if (resp.ok) {
        const data = await resp.json();
        col.entries = data.entries;
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
  rootEl.addEventListener("click", () => navigateToBreadcrumb("/"));
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
    partEl.addEventListener("click", () => navigateToBreadcrumb(partPath));
    breadcrumb.appendChild(partEl);
  });
}

function toggleHiddenFiles() {
  state.showHidden = document.getElementById("hidden-toggle").checked;
  renderColumns();
}

// ── Keyboard Navigation ──────────────────────────────────────────────

function setupKeyboardNavigation() {
  const columns = document.getElementById("columns");
  if (!columns) return;
  columns.setAttribute("tabindex", "0");
  columns.addEventListener("keydown", handleKeyNavigation);
}

function focusColumns() {
  const columns = document.getElementById("columns");
  if (columns) columns.focus();
}

function handleKeyNavigation(e) {
  if (state.columns.length === 0) return;

  const fc = state.focusedColumn;
  if (fc < 0 || fc >= state.columns.length) return;

  const column = state.columns[fc];
  const entries = getVisibleEntries(column);
  if (entries.length === 0 && e.key !== "ArrowLeft") return;

  // Use selectionCursor for keyboard position, fall back to last selected
  const cursorIdx =
    column.selectionCursor >= 0
      ? column.selectionCursor
      : (() => {
          const last = [...column.selected].pop();
          return entries.findIndex((en) => en.name === last);
        })();

  // Cancel rename on any navigation key
  if (state.renaming) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
      return;
    }
    // Let the input handle other keys
    return;
  }

  switch (e.key) {
    case "ArrowDown": {
      e.preventDefault();
      const next =
        cursorIdx < 0 ? 0 : Math.min(cursorIdx + 1, entries.length - 1);
      if (e.shiftKey) {
        const anchor =
          column.lastClickedIndex >= 0 ? column.lastClickedIndex : next;
        const start = Math.min(anchor, next);
        const end = Math.max(anchor, next);
        column.selected = new Set();
        for (let i = start; i <= end; i++) {
          column.selected.add(entries[i].name);
        }
        column.selectionCursor = next;
        renderColumns();
        scrollEntryIntoView(fc, next);
        focusColumns();
      } else {
        // Auto-open: select and show contents
        selectEntry(fc, entries[next]).then(() => {
          scrollEntryIntoView(fc, next);
          focusColumns();
        });
      }
      break;
    }
    case "ArrowUp": {
      e.preventDefault();
      const prev =
        cursorIdx < 0 ? entries.length - 1 : Math.max(cursorIdx - 1, 0);
      if (e.shiftKey) {
        const anchor =
          column.lastClickedIndex >= 0 ? column.lastClickedIndex : prev;
        const start = Math.min(anchor, prev);
        const end = Math.max(anchor, prev);
        column.selected = new Set();
        for (let i = start; i <= end; i++) {
          column.selected.add(entries[i].name);
        }
        column.selectionCursor = prev;
        renderColumns();
        scrollEntryIntoView(fc, prev);
        focusColumns();
      } else {
        selectEntry(fc, entries[prev]).then(() => {
          scrollEntryIntoView(fc, prev);
          focusColumns();
        });
      }
      break;
    }
    case "ArrowRight": {
      e.preventDefault();
      if (state.columns.length > fc + 1) {
        // Move focus into the next column
        state.focusedColumn = fc + 1;
        const newCol = state.columns[fc + 1];
        const newEntries = getVisibleEntries(newCol);
        if (newEntries.length > 0 && newCol.selected.size === 0) {
          // Auto-select and open first entry
          selectEntry(fc + 1, newEntries[0]).then(() => focusColumns());
        } else {
          renderColumns();
          focusColumns();
        }
      } else if (column.selected.size === 1) {
        // Re-open the selected entry
        const selectedName = [...column.selected][0];
        const selectedEntry = entries.find((en) => en.name === selectedName);
        if (selectedEntry) {
          selectEntry(fc, selectedEntry).then(() => {
            if (state.columns.length > fc + 1) {
              state.focusedColumn = fc + 1;
              const newCol = state.columns[fc + 1];
              const newEntries = getVisibleEntries(newCol);
              if (newEntries.length > 0 && newCol.selected.size === 0) {
                selectEntry(fc + 1, newEntries[0]).then(() => focusColumns());
              } else {
                renderColumns();
                focusColumns();
              }
            }
          });
        }
      }
      break;
    }
    case "Enter": {
      e.preventDefault();
      if (cursorIdx >= 0 && column.selected.size === 1) {
        startRename(fc, entries[cursorIdx].name);
      }
      break;
    }
    case "ArrowLeft": {
      e.preventDefault();
      if (fc > 0) {
        state.columns = state.columns.slice(0, fc);
        state.focusedColumn = fc - 1;
        renderColumns();
        updateBreadcrumb();
        focusColumns();
      }
      break;
    }
    case "Escape": {
      e.preventDefault();
      // Clear selection
      column.selected = new Set();
      column.lastClickedIndex = -1;
      column.selectionCursor = -1;
      state.columns = state.columns.slice(0, fc + 1);
      renderColumns();
      updateBreadcrumb();
      focusColumns();
      break;
    }
  }
}

function scrollEntryIntoView(colIndex, entryIndex) {
  const colEls = document.querySelectorAll("#columns > .column");
  if (colIndex >= colEls.length) return;
  const entryEls = colEls[colIndex].querySelectorAll(".column-entry");
  if (entryIndex >= entryEls.length) return;
  entryEls[entryIndex].scrollIntoView({ block: "nearest" });
}

// ── Terminal ─────────────────────────────────────────────────────────

function initTerminal() {
  const terminalEl = document.getElementById("terminal");

  // Resolve constructors -- CDN UMD exports may be namespaced
  const TerminalCtor =
    typeof Terminal === "function"
      ? Terminal
      : typeof Terminal === "object" && Terminal.Terminal
        ? Terminal.Terminal
        : null;

  const FitAddonCtor =
    typeof FitAddon === "function"
      ? FitAddon
      : typeof FitAddon === "object" && FitAddon.FitAddon
        ? FitAddon.FitAddon
        : null;

  if (!TerminalCtor) {
    console.error("xterm.js Terminal not found. Check CDN script loading.");
    terminalEl.innerHTML =
      '<div style="color:#f85149;padding:16px">Terminal failed to load (xterm.js unavailable)</div>';
    return;
  }

  try {
    state.terminal = new TerminalCtor({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "rgba(56, 139, 253, 0.3)",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39d353",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d364",
        brightWhite: "#f0f6fc",
      },
    });

    if (FitAddonCtor) {
      state.fitAddon = new FitAddonCtor();
      state.terminal.loadAddon(state.fitAddon);
    }

    state.terminal.open(terminalEl);

    setTimeout(() => {
      if (state.fitAddon) state.fitAddon.fit();
      startTerminalSession();
    }, 150);
  } catch (e) {
    console.error("Terminal init failed:", e);
    terminalEl.innerHTML =
      '<div style="color:#f85149;padding:16px">Terminal init error: ' +
      escapeHtml(e.message) +
      "</div>";
  }
}

function startTerminalSession() {
  if (typeof io === "undefined") {
    console.error("socket.io client not loaded");
    if (state.terminal) {
      state.terminal.write(
        "\r\n\x1b[31mSocket.io client not loaded. Check network/CDN.\x1b[0m\r\n",
      );
    }
    return;
  }

  state.socket = io();

  state.socket.on("connect", () => {
    const cols = state.terminal ? state.terminal.cols : 80;
    const rows = state.terminal ? state.terminal.rows : 24;
    state.socket.emit("terminal_start", { cols, rows });
  });

  state.socket.on("connect_error", (err) => {
    console.error("Socket.io connection error:", err);
  });

  state.socket.on("terminal_output", (data) => {
    if (state.terminal) state.terminal.write(data.data);
  });

  if (state.terminal) {
    state.terminal.onData((data) => {
      if (state.socket) state.socket.emit("terminal_input", { data });
    });

    state.terminal.onResize(({ cols, rows }) => {
      if (state.socket) state.socket.emit("terminal_resize", { cols, rows });
    });
  }
}

function cdToBrowserPath() {
  if (!state.terminal || state.columns.length === 0) return;

  let path = null;
  for (let i = state.columns.length - 1; i >= 0; i--) {
    if (state.columns[i].path) {
      path = state.columns[i].path;
      break;
    }
  }

  if (path && state.socket) {
    const escaped = path.replace(/([ '"\\$`!&()[\]{}|;*?<>])/g, "\\$1");
    state.socket.emit("terminal_input", {
      data: "cd " + escaped + "\n",
    });
    state.terminal.focus();
  }
}

// ── Directory Sizes ─────────────────────────────────────────────────

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

  const dirNames = column.entries.filter((e) => e.is_dir).map((e) => e.name);
  if (dirNames.length === 0) return;

  column.sizesLoaded = true;

  try {
    const resp = await fetch("/api/dir-sizes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: column.path, names: dirNames }),
    });
    const data = await resp.json();
    if (data.sizes) {
      // Verify column still exists
      if (
        colIndex >= state.columns.length ||
        state.columns[colIndex] !== column
      )
        return;

      for (const entry of column.entries) {
        if (entry.is_dir && data.sizes[entry.name] !== undefined) {
          entry.dirSize = data.sizes[entry.name];
        }
      }
      renderColumns();
    }
  } catch {
    // silently fail
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
      x: "xsS".includes(modeStr[3]),
    },
    group: {
      r: modeStr[4] === "r",
      w: modeStr[5] === "w",
      x: "xsS".includes(modeStr[6]),
    },
    others: {
      r: modeStr[7] === "r",
      w: modeStr[8] === "w",
      x: "xtT".includes(modeStr[9]),
    },
  };
}

function permBitsToOctal(bits) {
  function tripleToOctal(t) {
    return (t.r ? 4 : 0) + (t.w ? 2 : 0) + (t.x ? 1 : 0);
  }
  if (!bits.owner) return 0;
  return (
    tripleToOctal(bits.owner) * 64 +
    tripleToOctal(bits.group) * 8 +
    tripleToOctal(bits.others)
  );
}

function chmodToggle(path, bits, who, perm) {
  const active = bits[who] && bits[who][perm];
  const cls = active ? "chmod-pill active" : "chmod-pill";
  const newVal = active ? "false" : "true";
  return `<button class="${cls}" onclick="handleChmod('${escapeAttr(path)}', '${who}', '${perm}', ${newVal})">${perm.toUpperCase()}</button>`;
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
  if (bits[who]) bits[who][perm] = value;
  const octal = permBitsToOctal(bits);

  try {
    const resp = await fetch("/api/chmod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// ── Context Menu ─────────────────────────────────────────────────────

function showContextMenu(x, y, colIndex, entry, fullPath) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const items = [
    {
      label: "Copy Name",
      action: () => copyToClipboard(entry.name),
    },
    {
      label: "Copy Path",
      action: () => copyToClipboard(fullPath),
    },
    { separator: true },
    {
      label: "Rename",
      action: () => startRename(colIndex, entry.name),
    },
    { separator: true },
    {
      label: "Delete",
      action: () => confirmDelete(colIndex, entry, fullPath),
      danger: true,
    },
  ];

  items.forEach((item) => {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-separator";
      menu.appendChild(sep);
      return;
    }
    const el = document.createElement("div");
    el.className = "context-menu-item" + (item.danger ? " danger" : "");
    el.textContent = item.label;
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

  // Close on click outside or Escape
  setTimeout(() => {
    document.addEventListener("click", hideContextMenu, { once: true });
    document.addEventListener("contextmenu", hideContextMenu, { once: true });
  }, 0);
  document.addEventListener("keydown", handleContextMenuKey);
}

function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.remove();
  document.removeEventListener("keydown", handleContextMenuKey);
}

function handleContextMenuKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    hideContextMenu();
  }
}

async function confirmDelete(colIndex, entry, fullPath) {
  const name = entry.name;
  const what = entry.is_dir ? "folder" : "file";
  if (!confirm(`Delete ${what} "${name}"?`)) return;

  try {
    const resp = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

// ── Clipboard ────────────────────────────────────────────────────────

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showNotification("Copied to clipboard", "success");
  });
}

function escapeAttr(str) {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

  const column = state.columns[colIndex];
  if (!column || !column.path) return;

  const oldPath =
    column.path === "/" ? "/" + oldName : column.path + "/" + oldName;
  const newPath =
    column.path === "/" ? "/" + newName : column.path + "/" + newName;

  try {
    const resp = await fetch("/api/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: oldPath, dest: newPath }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showNotification(err.error || "Rename failed", "error");
    }
  } catch (e) {
    showNotification("Rename failed: " + e.message, "error");
  }

  await refreshColumns();
  focusColumns();
}

// ── UI Helpers ───────────────────────────────────────────────────────

function showScreen(name) {
  document
    .getElementById("connect-screen")
    .classList.toggle("hidden", name !== "connect");
  document
    .getElementById("main-screen")
    .classList.toggle("hidden", name !== "main");
}

function showNotification(message, type) {
  const el = document.getElementById("notification");
  el.textContent = message;
  el.className =
    "notification" +
    (type === "error" ? " error" : type === "success" ? " success" : "");
  el.classList.remove("hidden");

  setTimeout(() => {
    el.classList.add("hidden");
  }, 4000);
}

function setupResizeHandle() {
  const handle = document.getElementById("resize-handle");
  if (!handle) return;

  handle.addEventListener("mousedown", (e) => {
    state.isResizing = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!state.isResizing) return;

    const mainScreen = document.getElementById("main-screen");
    const browserContainer = document.getElementById("browser-container");
    const terminalContainer = document.getElementById("terminal-container");
    const toolbar = document.getElementById("toolbar");

    const rect = mainScreen.getBoundingClientRect();
    const toolbarHeight = toolbar.offsetHeight;
    const handleHeight = 4;

    const availableHeight = rect.height - toolbarHeight - handleHeight;
    const mouseY = e.clientY - rect.top - toolbarHeight;

    const browserFraction = Math.max(
      0.15,
      Math.min(0.85, mouseY / availableHeight),
    );
    const terminalFraction = 1 - browserFraction;

    browserContainer.style.flex = `0 0 ${browserFraction * 100}%`;
    terminalContainer.style.flex = `0 0 ${terminalFraction * 100}%`;

    if (state.fitAddon) {
      state.fitAddon.fit();
    }
  });

  document.addEventListener("mouseup", () => {
    if (state.isResizing) {
      state.isResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (state.fitAddon) {
        state.fitAddon.fit();
      }
    }
  });
}

function handleWindowResize() {
  if (state.fitAddon) {
    state.fitAddon.fit();
  }
}

// ── Utilities ────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return size + " " + units[i];
}

function formatDate(timestamp) {
  if (!timestamp) return "--";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanizePermissions(mode) {
  if (!mode || mode.length < 10) {
    return { owner: mode || "--", group: "--", others: "--" };
  }

  function parseTriple(r, w, x) {
    const parts = [];
    if (r === "r") parts.push("Read");
    if (w === "w") parts.push("Write");
    if (x === "x" || x === "s" || x === "t") parts.push("Execute");
    if (x === "S" || x === "T") parts.push("Set ID (no exec)");
    return parts.length > 0 ? parts.join(", ") : "None";
  }

  return {
    owner: parseTriple(mode[1], mode[2], mode[3]),
    group: parseTriple(mode[4], mode[5], mode[6]),
    others: parseTriple(mode[7], mode[8], mode[9]),
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
