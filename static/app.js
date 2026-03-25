// ── State ────────────────────────────────────────────────────────────

const state = {
  connected: false,
  connectionId: null,
  connections: [], // [{id, host, username, homeDir, savedState}]
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
  terminalHidden: false,
  sortMode: "name",
  sortAsc: true,
  dragSources: [],
  renaming: null, // { colIndex, name } when inline rename is active
  previewWrap: false,
  tmux: {
    active: false,
    session: null,
    windows: [],
    panes: [],
    pollInterval: null,
  },
  gitBranch: null,
  history: [],
  historyIndex: -1,
  historyPaused: false,
  search: { active: false, query: "" },
  editing: { active: false, path: null, originalContent: null },
  quickLook: { active: false, path: null },
  undoStack: [],
  fileWatcher: null,
  packagePanel: {
    open: false,
    packages: [],
    filter: "",
    venvPath: null,
    detectInfo: null,
    loading: false,
  },
};

let selectGeneration = 0;
let navAbortController = null;

// ── Cache ───────────────────────────────────────────────────────────

const apiCache = {
  _store: new Map(),

  _key(url, body) {
    return url + "|" + (body ? JSON.stringify(body) : "");
  },

  get(url, body) {
    const key = this._key(url, body);
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  },

  set(url, body, data, ttlMs) {
    const key = this._key(url, body);
    this._store.set(key, { data, expires: Date.now() + ttlMs });
  },

  // Invalidate entries whose URL or body key contains the given path
  invalidatePath(path) {
    for (const [key] of this._store) {
      if (key.includes(path)) this._store.delete(key);
    }
  },

  // Invalidate all entries for a given URL prefix
  invalidateUrl(url) {
    for (const [key] of this._store) {
      if (key.startsWith(url)) this._store.delete(key);
    }
  },

  clear() {
    this._store.clear();
  },
};

// Cached fetch helper: returns cached data or fetches, caches, and returns
function checkDisconnected(data, status) {
  if (
    state.connected &&
    (status === 400 || status === 500) &&
    data.error &&
    /not connected/i.test(data.error)
  ) {
    handleDisconnect();
    return true;
  }
  return false;
}

function connHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (state.connectionId) headers["X-Connection-Id"] = state.connectionId;
  return headers;
}

async function cachedPost(url, body, ttlMs, signal) {
  const cached = apiCache.get(url, body);
  if (cached) return cached;

  const opts = {
    method: "POST",
    headers: connHeaders(),
    body: JSON.stringify(body),
  };
  if (signal) opts.signal = signal;
  const resp = await fetch(url, opts);
  const data = await resp.json();
  if (checkDisconnected(data, resp.status)) return data;
  if (resp.ok) apiCache.set(url, body, data, ttlMs);
  return data;
}

async function cachedGet(url, ttlMs) {
  const cached = apiCache.get(url, null);
  if (cached) return cached;

  const resp = await fetch(url);
  const data = await resp.json();
  if (resp.ok) apiCache.set(url, null, data, ttlMs);
  return data;
}

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

// Context menu icons (SF Symbols style)
const CTX = {
  copyName: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 1.5h5.586a1 1 0 0 1 .707.293l2.414 2.414a1 1 0 0 1 .293.707V11.5a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 11.5v-8.5A1.5 1.5 0 0 1 4 1.5zm0 1a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 .5.5h7.5a.5.5 0 0 0 .5-.5V5h-2a1 1 0 0 1-1-1V2.5H4z"/></svg>`,
  copyPath: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>`,
  download: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z"/></svg>`,
  starFill: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/></svg>`,
  starEmpty: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767L8 12.202l3.229 1.66-.616-3.519 2.614-2.49-3.606-.513L8 4.275 6.394 7.34l-3.606.513 2.614 2.49-.616 3.519z"/></svg>`,
  duplicate: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`,
  rename: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293z"/></svg>`,
  trash: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>`,
  newFolder: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 3l.04.87a2 2 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H9v-1H2.826a1 1 0 0 1-.995-.91l-.637-7A1 1 0 0 1 2.19 4h11.62a1 1 0 0 1 .996 1.09L14.54 8h1.005l.256-2.819A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2m5.672-1H2.5a1 1 0 0 0-1 1l.03.4a2 2 0 0 1 .67-.4H6l-.328-.329A1 1 0 0 0 4.172 2z"/><path d="M13.5 10a.5.5 0 0 1 .5.5V12h1.5a.5.5 0 0 1 0 1H14v1.5a.5.5 0 0 1-1 0V13h-1.5a.5.5 0 0 1 0-1H13v-1.5a.5.5 0 0 1 .5-.5"/></svg>`,
  xmark: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>`,
  upload: `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V10.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/></svg>`,
};

// ── Initialization ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);

async function init() {
  initTheme();
  await loadSSHConfigs();
  setupResizeHandle();
  setupKeyboardNavigation();
  setupGlobalShortcuts();
  setupClipboardPaste();
  window.addEventListener("resize", handleWindowResize);
}

// ── Theme ────────────────────────────────────────────────────────────

const DARK_TERMINAL_THEME = {
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
};

const LIGHT_TERMINAL_THEME = {
  background: "#f6f8fa",
  foreground: "#1f2328",
  cursor: "#0969da",
  selectionBackground: "rgba(9, 105, 218, 0.2)",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#116329",
  brightYellow: "#7d4e00",
  brightBlue: "#0550ae",
  brightMagenta: "#6639ba",
  brightCyan: "#136e75",
  brightWhite: "#8c959f",
};

function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme", next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcons(theme);

  if (state.terminal) {
    state.terminal.options.theme =
      theme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
  }
}

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

function updateThemeIcons(theme) {
  // Sun icon for dark mode (click to go light), moon icon for light mode (click to go dark)
  const sunPath =
    "M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0zm0 13a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 13zM16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8zM3 8a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 3 8zm10.657-5.657a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.06 0zM4.464 11.536a.75.75 0 0 1 0 1.06l-1.06 1.061a.75.75 0 1 1-1.061-1.06l1.06-1.061a.75.75 0 0 1 1.06 0zm9.193 1.06a.75.75 0 0 1-1.06 0l-1.061-1.06a.75.75 0 0 1 1.06-1.061l1.061 1.06a.75.75 0 0 1 0 1.061zM4.464 4.465a.75.75 0 0 1-1.06 0l-1.061-1.061a.75.75 0 0 1 1.06-1.06l1.061 1.06a.75.75 0 0 1 0 1.06z";
  const moonPath =
    "M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z";

  document.querySelectorAll("[onclick='toggleTheme()'] path").forEach((el) => {
    el.setAttribute("d", theme === "dark" ? sunPath : moonPath);
  });
}

// ── SSH Config ───────────────────────────────────────────────────────

async function loadSSHConfigs() {
  try {
    const data = await cachedGet("/api/ssh-configs", 300000);

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
    if (starred.size >= 4) {
      showNotification("Maximum 4 starred hosts", "error");
      return false;
    }
    starred.add(name);
  }
  localStorage.setItem("starredHosts", JSON.stringify([...starred]));
  return true;
}

async function animateStarToggle(card, hostName) {
  const starredEl = document.getElementById("starred-hosts");
  const savedEl = document.getElementById("saved-hosts");
  const oldStarredH = starredEl.offsetHeight;
  const oldSavedH = savedEl.offsetHeight;

  // Check limit before animating
  const isStarred = getStarredHosts().has(hostName);
  if (!isStarred && getStarredHosts().size >= 4) {
    showNotification("Maximum 4 starred hosts", "error");
    return;
  }

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
      headers: connHeaders(),
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
      headers: connHeaders(),
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
      headers: connHeaders(),
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
  state.connectionId = data.connection_id;
  state.host = data.host;
  state.username = data.username;
  state.homeDir = data.home_dir;

  // Add to connections list
  state.connections.push({
    id: data.connection_id,
    host: data.host,
    username: data.username,
    homeDir: data.home_dir,
  });
  renderConnectionTabs();

  document.getElementById("connection-info").textContent =
    `${data.username}@${data.host}`;

  showScreen("main");
  seedSidebarIfNew();
  renderSidebar();
  navigateTo(data.home_dir);
  initTerminal();
  startTmuxPolling();
  startFileWatcher();
  setTimeout(setupDragSelection, 100);
}

async function handleDisconnect() {
  try {
    await fetch("/api/disconnect", {
      method: "POST",
      headers: connHeaders(),
    });
  } catch (_) {
    // ignore
  }

  // Remove from connections list
  const idx = state.connections.findIndex((c) => c.id === state.connectionId);
  if (idx >= 0) state.connections.splice(idx, 1);

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (state.terminal) {
    state.terminal.dispose();
    state.terminal = null;
    state.fitAddon = null;
  }

  stopTmuxPolling();
  stopFileWatcher();
  closePackageManager();
  apiCache.clear();
  state.undoStack = [];

  // If other connections exist, switch to one
  if (state.connections.length > 0) {
    switchToConnection(state.connections[state.connections.length - 1].id);
  } else {
    state.connected = false;
    state.connectionId = null;
    state.columns = [];
    state.focusedColumn = 0;
    renderConnectionTabs();
    showScreen("connect");
  }
}

// ── Connection Tabs ──────────────────────────────────────────────────

function renderConnectionTabs() {
  const tabBar = document.getElementById("connection-tabs");
  if (!tabBar) return;
  if (state.connections.length <= 1) {
    tabBar.classList.add("hidden");
    return;
  }
  tabBar.classList.remove("hidden");
  tabBar.innerHTML = "";
  state.connections.forEach((conn) => {
    const tab = document.createElement("div");
    tab.className =
      "conn-tab" + (conn.id === state.connectionId ? " active" : "");
    tab.innerHTML = `
      <span class="conn-tab-name">${escapeHtml(conn.username)}@${escapeHtml(conn.host)}</span>
      <span class="conn-tab-close" title="Disconnect">&times;</span>`;
    tab.querySelector(".conn-tab-name").addEventListener("click", () => {
      if (conn.id !== state.connectionId) switchToConnection(conn.id);
    });
    tab.querySelector(".conn-tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      const prev = state.connectionId;
      state.connectionId = conn.id;
      handleDisconnect();
    });
    tabBar.appendChild(tab);
  });
  const addBtn = document.createElement("div");
  addBtn.className = "conn-tab conn-tab-add";
  addBtn.textContent = "+";
  addBtn.title = "New connection";
  addBtn.addEventListener("click", () => {
    saveCurrentConnectionState();
    showScreen("connect");
  });
  tabBar.appendChild(addBtn);
}

function saveCurrentConnectionState() {
  const conn = state.connections.find((c) => c.id === state.connectionId);
  if (!conn) return;
  conn.savedState = {
    columns: state.columns,
    focusedColumn: state.focusedColumn,
    history: state.history,
    historyIndex: state.historyIndex,
    gitBranch: state.gitBranch,
    sortMode: state.sortMode,
    sortAsc: state.sortAsc,
    showHidden: state.showHidden,
  };
}

function switchToConnection(connId) {
  saveCurrentConnectionState();
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  if (state.terminal) {
    state.terminal.dispose();
    state.terminal = null;
    state.fitAddon = null;
  }
  stopTmuxPolling();
  stopFileWatcher();
  apiCache.clear();

  const conn = state.connections.find((c) => c.id === connId);
  if (!conn) return;

  state.connectionId = connId;
  state.host = conn.host;
  state.username = conn.username;
  state.homeDir = conn.homeDir;
  state.connected = true;

  if (conn.savedState) {
    state.columns = conn.savedState.columns;
    state.focusedColumn = conn.savedState.focusedColumn;
    state.history = conn.savedState.history;
    state.historyIndex = conn.savedState.historyIndex;
    state.gitBranch = conn.savedState.gitBranch;
    state.sortMode = conn.savedState.sortMode;
    state.sortAsc = conn.savedState.sortAsc;
    state.showHidden = conn.savedState.showHidden;
  } else {
    state.columns = [];
    state.focusedColumn = 0;
    state.history = [];
    state.historyIndex = -1;
  }

  document.getElementById("connection-info").textContent =
    `${conn.username}@${conn.host}`;
  showScreen("main");
  renderConnectionTabs();
  renderColumns();
  updateBreadcrumb();
  updateNavButtons();
  renderSidebar();
  initTerminal();
  startTmuxPolling();
  startFileWatcher();
  if (state.columns.length === 0) navigateTo(conn.homeDir);
}

// ── File Browser ─────────────────────────────────────────────────────

async function navigateTo(path) {
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
          bodyHtml = `<textarea class="file-editor-textarea" id="editor-textarea">${escapeHtml(state.editing.originalContent)}</textarea>`;
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
      const isTextFile = preview.content != null && !preview.truncated;
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
                    <div class="file-info-name">${escapeHtml(info.name)} <span class="copy-icon" onclick="copyToClipboard('${escapeAttr(info.name)}')" title="Copy name">${COPY_ICON}</span></div>
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

async function refreshColumns() {
  // Invalidate ls and dir-sizes cache so re-fetches hit the server
  apiCache.invalidateUrl("/api/ls");
  apiCache.invalidateUrl("/api/dir-sizes");
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
  pathBar.innerHTML = `<span class="path-bar-text"><bdi>${escapeHtml(displayPath)}</bdi></span><button class="path-bar-copy" onclick="copyToClipboard('${escapeAttr(displayPath)}')" title="Copy path">${COPY_ICON}</button>${branchHtml}`;
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
    const data = await cachedPost("/api/git-info", { path: dirPath }, 120000);
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
      // Nothing selected -- select first entry so user can start navigating
      if (column.selected.size === 0 && entries.length > 0) {
        selectEntry(fc, entries[0]).then(() => focusColumns());
        break;
      }
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
      allowProposedApi: true,
      theme:
        getCurrentTheme() === "light"
          ? LIGHT_TERMINAL_THEME
          : DARK_TERMINAL_THEME,
    });

    if (FitAddonCtor) {
      state.fitAddon = new FitAddonCtor();
      state.terminal.loadAddon(state.fitAddon);
    }

    state.terminal.open(terminalEl);

    // Click-to-move-cursor: query cursor position via DSR, then send arrow keys
    setupTerminalClickHandler(state.terminal);

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
    state.socket.emit("terminal_start", {
      cols,
      rows,
      connection_id: state.connectionId,
    });
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

// ── Terminal Click-to-Move ────────────────────────────────────────────

function setupTerminalClickHandler(term) {
  // When user clicks in the terminal, query cursor position via DSR,
  // then send arrow keys to move the cursor to the clicked column.
  term.element.addEventListener("click", (e) => {
    if (!state.socket) return;
    // Don't interfere if text is selected
    const selection = term.getSelection();
    if (selection && selection.length > 0) return;

    // Calculate clicked column from terminal geometry
    const termEl = term.element.querySelector(".xterm-screen");
    if (!termEl) return;
    const termRect = termEl.getBoundingClientRect();
    const cellWidth = termRect.width / term.cols;
    const clickCol = Math.floor((e.clientX - termRect.left) / cellWidth);

    // Query current cursor position via DSR (Device Status Report)
    // Response format: ESC [ row ; col R
    requestCursorPosition(term, (cursorRow, cursorCol) => {
      const clickedRow = term.buffer.active.cursorY;

      // Only move on the same row as cursor (command line editing)
      if (clickedRow !== cursorRow) return;

      const diff = clickCol - cursorCol;
      if (diff === 0) return;

      // Send arrow keys
      const arrow = diff > 0 ? "\x1b[C" : "\x1b[D";
      const count = Math.abs(diff);
      const keys = arrow.repeat(count);
      state.socket.emit("terminal_input", { data: keys });
    });
  });
}

function requestCursorPosition(term, callback) {
  // Send DSR (ESC[6n) and parse response (ESC[row;colR)
  let responseData = "";
  let listening = true;

  const dispose = term.onData((data) => {
    if (!listening) return;

    // Check if this data contains a DSR response
    responseData += data;
    const match = responseData.match(/\x1b\[(\d+);(\d+)R/);
    if (match) {
      listening = false;
      dispose.dispose();
      const row = parseInt(match[1]) - 1; // 0-indexed
      const col = parseInt(match[2]) - 1; // 0-indexed
      callback(row, col);
    }
  });

  // Send DSR query
  if (state.socket) {
    state.socket.emit("terminal_input", { data: "\x1b[6n" });
  }

  // Timeout: clean up after 500ms if no response
  setTimeout(() => {
    if (listening) {
      listening = false;
      dispose.dispose();
    }
  }, 500);
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
    createNewFolder(dirPath);
  });
  menu.appendChild(newFolderItem);

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

async function createNewFolder(dirPath) {
  const name = prompt("New folder name:");
  if (!name) return;

  const fullPath = dirPath === "/" ? "/" + name : dirPath + "/" + name;

  try {
    const resp = await fetch("/api/mkdir", {
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
      items.push({
        icon: CTX.copyName,
        label: "Get Info",
        action: () => showFolderInfo(colIndex, entry, fullPath),
      });
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

async function downloadFile(path) {
  try {
    const resp = await fetch("/api/download", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      showNotification(err.error || "Download failed", "error");
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop();
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showNotification("Download failed: " + e.message, "error");
  }
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

// ── UI Helpers ───────────────────────────────────────────────────────

function showScreen(name) {
  document
    .getElementById("connect-screen")
    .classList.toggle("hidden", name !== "connect");
  document
    .getElementById("main-screen")
    .classList.toggle("hidden", name !== "main");
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

// ── Search / Filter ──────────────────────────────────────────────────

function toggleSearchBar() {
  state.search.active = !state.search.active;
  if (!state.search.active) {
    state.search.query = "";
    renderColumns();
  }
  renderSearchBar();
}

function renderSearchBar() {
  let bar = document.getElementById("search-bar");
  if (!state.search.active) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "search-bar";
    bar.className = "search-bar";
    const browserContainer = document.getElementById("browser-container");
    browserContainer.parentNode.insertBefore(bar, browserContainer);
  }
  bar.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
      <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/>
    </svg>
    <input id="search-input" type="text" placeholder="Filter files..." value="${escapeAttr(state.search.query)}" />
    <button class="btn btn-icon search-close" onclick="toggleSearchBar()" title="Close (Esc)">
      ${CTX.xmark}
    </button>
  `;
  const input = bar.querySelector("#search-input");
  input.addEventListener("input", (e) => {
    state.search.query = e.target.value;
    renderColumns();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      toggleSearchBar();
      focusColumns();
    }
    e.stopPropagation();
  });
  input.focus();
}

// ── File Upload ──────────────────────────────────────────────────────

function handleFileUpload(files, destDir) {
  const formData = new FormData();
  formData.append("dest_dir", destDir);
  for (const file of files) {
    formData.append("files", file);
  }

  // Create progress bar
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
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.error) showNotification(data.error, "error");
        else
          showNotification(
            `Uploaded ${data.uploaded?.length || 0} file(s)`,
            "success",
          );
      } catch {
        showNotification("Upload completed", "success");
      }
      refreshColumns().then(resolve);
    };
    xhr.onerror = () => {
      progressEl.style.display = "none";
      showNotification("Upload failed", "error");
      resolve();
    };
    xhr.open("POST", "/api/upload");
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

// ── Text Editor ──────────────────────────────────────────────────────

function startEditing() {
  const previewCol = state.columns.find(
    (c) => c.filePreview && c.filePreview.content != null,
  );
  if (!previewCol) return;
  state.editing = {
    active: true,
    path: previewCol.filePreview.path,
    originalContent: previewCol.filePreview.content,
  };
  renderColumns();
  const textarea = document.getElementById("editor-textarea");
  if (textarea) textarea.focus();
}

async function saveEditedFile() {
  const textarea = document.getElementById("editor-textarea");
  if (!textarea || !state.editing.active) return;
  const content = textarea.value;
  const path = state.editing.path;

  try {
    const resp = await fetch("/api/save-file", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ path, content }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification(data.error, "error");
      return;
    }
    showNotification("File saved", "success");
    state.editing = { active: false, path: null, originalContent: null };
    // Invalidate preview cache and re-fetch
    apiCache.invalidateUrl("/api/preview");
    const previewCol = state.columns.find(
      (c) => c.filePreview && c.filePreview.path === path,
    );
    if (previewCol) {
      previewCol.filePreview.content = content;
      previewCol.filePreview.loaded = true;
    }
    renderColumns();
  } catch (e) {
    showNotification("Save failed: " + e.message, "error");
  }
}

function cancelEditing() {
  state.editing = { active: false, path: null, originalContent: null };
  renderColumns();
}

// ── Global Keyboard Shortcuts ────────────────────────────────────────

function setupGlobalShortcuts() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (!state.connected) return;

      // Don't intercept when typing in inputs (except specific shortcuts)
      const tag = document.activeElement?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const isTerminal = document.activeElement?.closest("#terminal-container");

      // Cmd+S -- save file (works even in textarea)
      if (e.metaKey && e.key === "s") {
        if (state.editing.active) {
          e.preventDefault();
          saveEditedFile();
          return;
        }
      }

      // Cmd+F -- search/filter
      if (e.metaKey && e.key === "f") {
        e.preventDefault();
        toggleSearchBar();
        return;
      }

      // Cmd+G -- go to path
      if (e.metaKey && e.key === "g") {
        e.preventDefault();
        showGoToPathDialog();
        return;
      }

      // Skip remaining shortcuts if in terminal or input
      if (isTerminal || isInput) return;

      // Cmd+Z -- undo
      if (e.metaKey && e.key === "z") {
        e.preventDefault();
        undoLastAction();
        return;
      }

      // Spacebar -- Quick Look
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleQuickLook();
        return;
      }

      // Cmd+[ -- back
      if (e.metaKey && e.key === "[") {
        e.preventDefault();
        navigateBack();
        return;
      }

      // Cmd+] -- forward
      if (e.metaKey && e.key === "]") {
        e.preventDefault();
        navigateForward();
        return;
      }

      // Cmd+Shift+N -- new folder
      if (e.metaKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        const col = state.columns[state.focusedColumn];
        if (col && col.path) createNewFolder(col.path);
        return;
      }

      // Cmd+D -- duplicate
      if (e.metaKey && e.key === "d") {
        e.preventDefault();
        const info = getSelectedEntryInfo();
        if (info) duplicateEntry(info.colIndex, info.entry, info.fullPath);
        return;
      }

      // Cmd+Backspace -- delete
      if (e.metaKey && e.key === "Backspace") {
        e.preventDefault();
        const col = state.columns[state.focusedColumn];
        if (col && col.selected.size > 1) {
          confirmDeleteMulti(state.focusedColumn);
        } else {
          const info = getSelectedEntryInfo();
          if (info) confirmDelete(info.colIndex, info.entry, info.fullPath);
        }
        return;
      }
    },
    true,
  ); // capture phase for Cmd+F
}

function getSelectedEntryInfo() {
  const fc = state.focusedColumn;
  const col = state.columns[fc];
  if (!col || col.selected.size !== 1) return null;
  const name = [...col.selected][0];
  const entries = getVisibleEntries(col);
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  const fullPath = col.path === "/" ? "/" + name : col.path + "/" + name;
  return { colIndex: fc, entry, fullPath };
}

// ── Go to Path (Cmd+G) ───────────────────────────────────────────────

function showGoToPathDialog() {
  if (document.getElementById("goto-overlay")) return;
  const currentPath =
    state.columns.length > 0
      ? state.columns[state.columns.length - 1].path || ""
      : "";
  const overlay = document.createElement("div");
  overlay.id = "goto-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog goto-dialog">
      <div class="modal-title">Go to Path</div>
      <input id="goto-input" class="modal-input" type="text" value="${escapeAttr(currentPath)}" placeholder="/path/to/directory" />
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const input = document.getElementById("goto-input");
  input.select();
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      overlay.remove();
      navigateTo(input.value.trim());
    }
    if (e.key === "Escape") overlay.remove();
  });
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
  const paths = [];
  for (const col of state.columns) {
    if (!col.path || col.fileInfo || col.filePreview || col.loading) continue;
    const maxMtime = col.entries.reduce((m, e) => Math.max(m, e.mtime || 0), 0);
    paths.push({ path: col.path, mtime: maxMtime });
  }
  if (paths.length === 0) return;
  try {
    const data = await cachedPost("/api/check-modified", { paths }, 0);
    if (data.changed && data.changed.length > 0) {
      apiCache.invalidateUrl("/api/ls");
      apiCache.invalidateUrl("/api/dir-sizes");
      await refreshColumns();
    }
  } catch {}
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
      await fetch("/api/move", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ src: action.dest, dest: action.src }),
      });
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

// ── Custom Commands ──────────────────────────────────────────────────

function showCustomCommandDialog(paths, cwd) {
  const overlay = document.createElement("div");
  overlay.id = "command-overlay";
  overlay.className = "modal-overlay";
  const recentCmds = JSON.parse(localStorage.getItem("recentCommands") || "[]");
  const recentHtml = recentCmds
    .map(
      (c) =>
        `<div class="command-history-item" data-cmd="${escapeAttr(c)}">${escapeHtml(c)}</div>`,
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
      await fetch("/api/batch-rename", {
        method: "POST",
        headers: connHeaders(),
        body: JSON.stringify({ renames }),
      });
      showNotification(`Renamed ${renames.length} files`, "success");
      for (const r of renames)
        pushUndo({ type: "rename", src: r.src, dest: r.dest });
    } catch (e) {
      showNotification("Batch rename failed: " + e.message, "error");
    }
    overlay.remove();
    await refreshColumns();
  });
  findInput.focus();
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

// ── SSH Key Manager ──────────────────────────────────────────────────

async function showKeyManager() {
  const overlay = document.createElement("div");
  overlay.id = "keymanager-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog key-manager-dialog">
      <div class="modal-title">SSH Keys</div>
      <div id="key-list" class="key-list">Loading...</div>
      <div class="modal-actions">
        <button class="btn btn-save" onclick="showGenerateKeyForm()">Generate New Key</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('keymanager-overlay').remove()">Close</button>
      </div>
    </div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  await refreshKeyList();
}

async function refreshKeyList() {
  const list = document.getElementById("key-list");
  if (!list) return;
  try {
    const data = await fetch("/api/ssh-keys").then((r) => r.json());
    if (!data.keys || data.keys.length === 0) {
      list.innerHTML =
        '<div class="modal-hint">No SSH keys found in ~/.ssh/</div>';
      return;
    }
    list.innerHTML = data.keys
      .map(
        (k) => `
      <div class="key-row">
        <div class="key-info">
          <span class="key-name">${escapeHtml(k.name)}</span>
          ${k.type ? `<span class="key-type">${escapeHtml(k.type)}</span>` : ""}
          ${k.fingerprint ? `<div class="key-fingerprint">${escapeHtml(k.fingerprint)}</div>` : ""}
        </div>
        <div class="key-actions">
          ${k.has_pub ? `<button class="btn btn-sm btn-edit" onclick="copyPublicKey('${escapeAttr(k.name)}')">Copy Public Key</button>` : ""}
        </div>
      </div>`,
      )
      .join("");
  } catch (e) {
    list.innerHTML = `<div class="modal-hint">Error: ${escapeHtml(e.message)}</div>`;
  }
}

async function copyPublicKey(name) {
  try {
    const data = await fetch(
      "/api/ssh-keys/public?name=" + encodeURIComponent(name),
    ).then((r) => r.json());
    if (data.content) {
      await copyToClipboard(data.content);
      showNotification("Public key copied", "success");
    } else showNotification(data.error || "Failed", "error");
  } catch (e) {
    showNotification(e.message, "error");
  }
}

function showGenerateKeyForm() {
  const list = document.getElementById("key-list");
  if (!list) return;
  list.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <input id="keygen-name" class="modal-input" placeholder="Key name (e.g. id_ed25519)" value="id_ed25519" />
      <select id="keygen-type" class="modal-input"><option value="ed25519">Ed25519</option><option value="rsa">RSA</option></select>
      <input id="keygen-passphrase" class="modal-input" type="password" placeholder="Passphrase (optional)" />
      <input id="keygen-comment" class="modal-input" placeholder="Comment (optional)" />
      <button class="btn btn-save" onclick="generateKey()">Generate</button>
      <button class="btn btn-secondary btn-sm" onclick="refreshKeyList()">Back</button>
    </div>`;
  [].forEach.call(list.querySelectorAll("input, select"), (el) =>
    el.addEventListener("keydown", (e) => e.stopPropagation()),
  );
}

async function generateKey() {
  const name = document.getElementById("keygen-name").value.trim();
  const type = document.getElementById("keygen-type").value;
  const passphrase = document.getElementById("keygen-passphrase").value;
  const comment = document.getElementById("keygen-comment").value.trim();
  if (!name) {
    showNotification("Name is required", "error");
    return;
  }
  try {
    const data = await fetch("/api/ssh-keys/generate", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ name, type, passphrase, comment }),
    }).then((r) => r.json());
    if (data.error) {
      showNotification(data.error, "error");
      return;
    }
    showNotification("Key generated", "success");
    await refreshKeyList();
  } catch (e) {
    showNotification(e.message, "error");
  }
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
    const tmuxBar = document.getElementById("tmux-bar");
    const pathBar = document.getElementById("path-bar");

    const rect = mainScreen.getBoundingClientRect();
    const toolbarHeight = toolbar.offsetHeight;
    const handleHeight = 4;
    const distFromBottom = rect.bottom - e.clientY;

    // Snap zone: if mouse is within 50px of the bottom, hide terminal
    if (distFromBottom < 50) {
      if (!state.terminalHidden) {
        state.terminalHidden = true;
        browserContainer.style.flex = "1 1 auto";
        terminalContainer.style.flex = "0 0 0px";
        terminalContainer.style.display = "none";
        if (tmuxBar) tmuxBar.style.display = "none";
      }
      return;
    }

    // Snap back: if terminal was hidden and user drags above snap zone
    if (state.terminalHidden) {
      state.terminalHidden = false;
      terminalContainer.style.display = "";
      if (tmuxBar) tmuxBar.style.display = "";
    }

    const pathBarHeight = pathBar ? pathBar.offsetHeight : 0;
    const tmuxBarHeight =
      tmuxBar && !tmuxBar.classList.contains("hidden")
        ? tmuxBar.offsetHeight
        : 0;
    // Fixed elements above the handle: toolbar + pathBar
    // Fixed elements at/below the handle: handle + tmuxBar
    const fixedAbove = toolbarHeight + pathBarHeight;
    const fixedBelow = handleHeight + tmuxBarHeight;
    const availableHeight = rect.height - fixedAbove - fixedBelow;

    const mouseFromTop = e.clientY - rect.top;
    const browserHeight = Math.max(
      availableHeight * 0.15,
      Math.min(availableHeight * 0.85, mouseFromTop - fixedAbove),
    );
    const terminalHeight = availableHeight - browserHeight;

    browserContainer.style.flex = `0 0 ${browserHeight}px`;
    terminalContainer.style.flex = `0 0 ${terminalHeight}px`;

    if (state.fitAddon) {
      state.fitAddon.fit();
    }
  });

  document.addEventListener("mouseup", () => {
    if (state.isResizing) {
      state.isResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (state.fitAddon && !state.terminalHidden) {
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

// ── Tmux GUI ─────────────────────────────────────────────────────────

function startTmuxPolling() {
  if (state.tmux.pollInterval) return;
  refreshTmuxState();
  state.tmux.pollInterval = setInterval(refreshTmuxState, 2000);
}

function stopTmuxPolling() {
  if (state.tmux.pollInterval) {
    clearInterval(state.tmux.pollInterval);
    state.tmux.pollInterval = null;
  }
  state.tmux.active = false;
  state.tmux.windows = [];
  const bar = document.getElementById("tmux-bar");
  if (bar) bar.classList.add("hidden");
}

async function refreshTmuxState() {
  try {
    const statusResp = await fetch("/api/tmux/status");
    const status = await statusResp.json();

    state.tmux.active = status.active;
    state.tmux.session = status.session;

    if (!status.active) {
      state.tmux.windows = [];
      const bar = document.getElementById("tmux-bar");
      if (bar) bar.classList.add("hidden");
      return;
    }

    const [windowsResp, panesResp] = await Promise.all([
      fetch("/api/tmux/windows", { headers: connHeaders() }),
      fetch("/api/tmux/panes", { headers: connHeaders() }),
    ]);
    const windowsData = await windowsResp.json();
    const panesData = await panesResp.json();
    state.tmux.windows = windowsData.windows || [];
    state.tmux.panes = panesData.panes || [];

    renderTmuxBar();
  } catch {
    // silently fail
  }
}

function renderTmuxBar() {
  const bar = document.getElementById("tmux-bar");
  if (!bar) return;

  if (!state.tmux.active || state.tmux.windows.length === 0) {
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  bar.innerHTML = "";

  // Window tabs
  const tabs = document.createElement("div");
  tabs.className = "tmux-tabs";

  state.tmux.windows.forEach((win) => {
    const tab = document.createElement("div");
    tab.className = "tmux-tab" + (win.active ? " active" : "");
    tab.innerHTML = `<span class="tmux-tab-label">${escapeHtml(win.name)}</span>`;
    tab.addEventListener("click", () => tmuxSelectWindow(win.index));
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showTmuxContextMenu(e.clientX, e.clientY, win);
    });
    tab.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        tmuxKillWindow(win.index);
      }
    });
    tabs.appendChild(tab);
  });
  bar.appendChild(tabs);

  // New tab
  const addBtn = document.createElement("button");
  addBtn.className = "tmux-add-btn";
  addBtn.title = "New terminal tab";
  addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2"/></svg>`;
  addBtn.addEventListener("click", tmuxNewWindow);
  bar.appendChild(addBtn);

  // Pane layout minimap (only if multiple panes)
  const panes = state.tmux.panes || [];
  if (panes.length > 1) {
    const minimap = document.createElement("div");
    minimap.className = "tmux-pane-map";

    // Calculate total dimensions
    const totalW = Math.max(...panes.map((p) => p.left + p.width));
    const totalH = Math.max(...panes.map((p) => p.top + p.height));

    panes.forEach((pane) => {
      const cell = document.createElement("div");
      cell.className = "tmux-pane-cell" + (pane.active ? " active" : "");
      cell.style.left = (pane.left / totalW) * 100 + "%";
      cell.style.top = (pane.top / totalH) * 100 + "%";
      cell.style.width = (pane.width / totalW) * 100 + "%";
      cell.style.height = (pane.height / totalH) * 100 + "%";
      cell.title = pane.command + (pane.active ? " (active)" : "");
      cell.addEventListener("click", () => {
        fetch("/api/tmux/select-pane", {
          method: "POST",
          headers: connHeaders(),
          body: JSON.stringify({ pane_id: pane.id }),
        }).then(() => refreshTmuxState());
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showPaneContextMenu(e.clientX, e.clientY, pane);
      });
      minimap.appendChild(cell);
    });
    bar.appendChild(minimap);
  }
}

function showPaneContextMenu(x, y, pane) {
  hideContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const items = [
    {
      icon: CTX.duplicate,
      label: "Split Left/Right",
      action: () => tmuxSplitPane("h"),
    },
    {
      icon: CTX.duplicate,
      label: "Split Top/Bottom",
      action: () => tmuxSplitPane("v"),
    },
    { separator: true },
    {
      icon: CTX.xmark,
      label: "Close Pane",
      action: () => {
        fetch("/api/tmux/kill-pane", {
          method: "POST",
          headers: connHeaders(),
          body: JSON.stringify({ pane_id: pane.id }),
        }).then(() => refreshTmuxState());
      },
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
    el.innerHTML = `<span class="ctx-icon">${item.icon}</span><span>${item.label}</span>`;
    el.addEventListener("click", () => {
      hideContextMenu();
      item.action();
    });
    menu.appendChild(el);
  });

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

function showTmuxContextMenu(x, y, win) {
  hideContextMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "context-menu";

  const items = [
    {
      icon: CTX.rename,
      label: "Rename Tab",
      action: () => tmuxRenameWindow(win.index),
    },
    { separator: true },
    {
      icon: CTX.duplicate,
      label: "Split Left/Right",
      action: () => tmuxSplitPane("h"),
    },
    {
      icon: CTX.duplicate,
      label: "Split Top/Bottom",
      action: () => tmuxSplitPane("v"),
    },
    { separator: true },
    {
      icon: CTX.xmark,
      label: "Close Tab",
      action: () => tmuxKillWindow(win.index),
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
    el.innerHTML = `<span class="ctx-icon">${item.icon}</span><span>${item.label}</span>`;
    el.addEventListener("click", () => {
      hideContextMenu();
      item.action();
    });
    menu.appendChild(el);
  });

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

async function tmuxNewWindow() {
  try {
    await fetch("/api/tmux/new-window", { method: "POST" });
    await refreshTmuxState();
  } catch (e) {
    showNotification("Failed to create window: " + e.message, "error");
  }
}

async function tmuxSelectWindow(index) {
  try {
    await fetch("/api/tmux/select-window", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ index }),
    });
    await refreshTmuxState();
  } catch (e) {
    showNotification("Failed to select window: " + e.message, "error");
  }
}

function tmuxRenameWindow(index) {
  const win = state.tmux.windows.find((w) => w.index === index);
  const currentName = win ? win.name : "";
  const name = prompt("Rename window:", currentName);
  if (name === null) return;

  fetch("/api/tmux/rename-window", {
    method: "POST",
    headers: connHeaders(),
    body: JSON.stringify({ index, name }),
  })
    .then(() => refreshTmuxState())
    .catch((e) => showNotification("Rename failed: " + e.message, "error"));
}

async function tmuxKillWindow(index) {
  if (!confirm("Close this tmux window?")) return;
  try {
    await fetch("/api/tmux/kill-window", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ index }),
    });
    await refreshTmuxState();
  } catch (e) {
    showNotification("Failed to close window: " + e.message, "error");
  }
}

async function tmuxSplitPane(direction) {
  try {
    await fetch("/api/tmux/split-pane", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ direction }),
    });
    await refreshTmuxState();
  } catch (e) {
    showNotification("Failed to split pane: " + e.message, "error");
  }
}

// ── Package Manager ──────────────────────────────────────────────────

async function openPackageManager() {
  const panel = document.getElementById("package-panel");
  if (!panel) return;

  state.packagePanel.open = true;
  state.packagePanel.loading = true;
  panel.classList.remove("hidden");
  renderPackagePanel();

  try {
    state.packagePanel.detectInfo = await cachedGet(
      "/api/packages/detect",
      120000,
    );

    // Use first nearby venv or active venv
    if (state.packagePanel.detectInfo.active_venv) {
      state.packagePanel.venvPath = state.packagePanel.detectInfo.active_venv;
    } else if (
      state.packagePanel.detectInfo.nearby_venvs &&
      state.packagePanel.detectInfo.nearby_venvs.length > 0
    ) {
      state.packagePanel.venvPath =
        state.packagePanel.detectInfo.nearby_venvs[0];
    }

    await fetchPackageList();
  } catch (e) {
    state.packagePanel.loading = false;
    renderPackagePanel();
    showNotification("Failed to detect packages: " + e.message, "error");
  }
}

function closePackageManager() {
  const panel = document.getElementById("package-panel");
  if (panel) panel.classList.add("hidden");
  state.packagePanel.open = false;
}

async function fetchPackageList() {
  state.packagePanel.loading = true;
  renderPackagePanel();

  try {
    const resp = await fetch("/api/packages/list", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({ venv_path: state.packagePanel.venvPath }),
    });
    const data = await resp.json();
    state.packagePanel.packages = data.packages || [];
  } catch {
    state.packagePanel.packages = [];
  }

  state.packagePanel.loading = false;
  renderPackagePanel();
}

function renderPackagePanel() {
  const panel = document.getElementById("package-panel");
  if (!panel) return;

  const info = state.packagePanel.detectInfo;
  const mgr =
    info && info.has_uv ? "uv" : info && info.has_pip ? "pip" : "none";

  let venvOptions = '<option value="">System</option>';
  if (info && info.nearby_venvs) {
    info.nearby_venvs.forEach((v) => {
      const selected = v === state.packagePanel.venvPath ? " selected" : "";
      const name = v.split("/").slice(-2).join("/");
      venvOptions += `<option value="${escapeAttr(v)}"${selected}>${escapeHtml(name)}</option>`;
    });
  }

  let listHtml;
  if (state.packagePanel.loading) {
    listHtml =
      '<div class="package-loading"><span class="loading"></span></div>';
  } else {
    const filter = state.packagePanel.filter.toLowerCase();
    const filtered = state.packagePanel.packages.filter(
      (p) => !filter || p.name.toLowerCase().includes(filter),
    );

    if (filtered.length === 0) {
      listHtml = '<div class="package-empty">No packages found</div>';
    } else {
      listHtml = filtered
        .map(
          (p) => `<div class="package-row">
          <span class="package-name">${escapeHtml(p.name)}</span>
          <span class="package-version">${escapeHtml(p.version)}</span>
          <button class="package-uninstall" onclick="uninstallPackage('${escapeAttr(p.name)}')">Remove</button>
        </div>`,
        )
        .join("");
    }
  }

  panel.innerHTML = `
    <div class="package-header">
      <div class="package-header-left">
        <span class="package-title">Packages</span>
        <span class="package-badge">${mgr}</span>
      </div>
      <button class="package-close" onclick="closePackageManager()">&times;</button>
    </div>
    <div class="package-venv-bar">
      <select class="venv-selector" onchange="switchVenv(this.value)">
        ${venvOptions}
      </select>
    </div>
    <div class="package-search">
      <input type="text" placeholder="Filter packages..." value="${escapeAttr(state.packagePanel.filter)}" oninput="state.packagePanel.filter = this.value; renderPackagePanel();" />
    </div>
    <div class="package-list">${listHtml}</div>
    <div class="package-install-bar">
      <input type="text" id="package-install-input" placeholder="Package name..." onkeydown="if(event.key==='Enter'){event.preventDefault();installPackageFromInput();}" />
      <button class="package-install-btn" onclick="installPackageFromInput()">Install</button>
    </div>
  `;
}

async function installPackageFromInput() {
  const input = document.getElementById("package-install-input");
  if (!input || !input.value.trim()) return;

  const name = input.value.trim();
  input.disabled = true;

  try {
    const resp = await fetch("/api/packages/install", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({
        package: name,
        venv_path: state.packagePanel.venvPath,
      }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification("Install failed: " + data.error, "error");
    } else {
      showNotification(`Installed ${name}`, "success");
      input.value = "";
      await fetchPackageList();
    }
  } catch (e) {
    showNotification("Install failed: " + e.message, "error");
  } finally {
    input.disabled = false;
  }
}

async function uninstallPackage(name) {
  if (!confirm(`Uninstall ${name}?`)) return;

  try {
    const resp = await fetch("/api/packages/uninstall", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify({
        package: name,
        venv_path: state.packagePanel.venvPath,
      }),
    });
    const data = await resp.json();
    if (data.error) {
      showNotification("Uninstall failed: " + data.error, "error");
    } else {
      showNotification(`Uninstalled ${name}`, "success");
      await fetchPackageList();
    }
  } catch (e) {
    showNotification("Uninstall failed: " + e.message, "error");
  }
}

async function switchVenv(path) {
  state.packagePanel.venvPath = path || null;
  await fetchPackageList();
}
