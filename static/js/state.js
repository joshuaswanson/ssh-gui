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
  terminalEnded: false,
  disconnecting: false,
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
    inTmux: false,
  },
  gitBranch: null,
  history: [],
  historyIndex: -1,
  historyPaused: false,
  search: { active: false, query: "" },
  editing: {
    active: false,
    path: null,
    originalContent: null,
    draft: null,
    mtime: null,
    crlf: false,
  },
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
    !state.disconnecting &&
    status === 400 &&
    data.error === "Not connected"
  ) {
    showNotification(`Connection to ${state.host} was lost`, "error");
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

  const resp = await fetch(url, { headers: connHeaders() });
  const data = await resp.json();
  if (resp.ok) apiCache.set(url, null, data, ttlMs);
  return data;
}
