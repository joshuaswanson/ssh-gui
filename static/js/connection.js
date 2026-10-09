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

// A jump host and its target can each need confirmation, hence the loop.
async function requestConnection(params) {
  let body = params;
  for (;;) {
    const response = await fetch("/api/connect", {
      method: "POST",
      headers: connHeaders(),
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.status !== "unknown_host") return data;

    const keyType = data.key_type.replace(/^ssh-/, "").toUpperCase();
    const trusted = confirm(
      `${data.hostname} is not in your known_hosts file.\n\n` +
        `${keyType} key fingerprint:\n${data.fingerprint}\n\n` +
        "Trust this host and continue connecting?",
    );
    if (!trusted) return { status: "error", message: "Host key not trusted" };
    body = { ...params, trusted_fingerprint: data.fingerprint };
  }
}

async function connectToHost(host) {
  document
    .querySelectorAll(".host-card")
    .forEach((c) => (c.style.opacity = "0.5"));

  try {
    const data = await requestConnection({
      config_host: host.name,
      hostname: host.hostname,
      username: host.user,
      port: host.port,
      key_file: host.identity_file,
    });

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
    const data = await requestConnection({
      hostname,
      username,
      password,
      port: parseInt(port),
      key_file: keyFile,
    });

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
  if (state.disconnecting) return;
  state.disconnecting = true;
  try {
    await fetch("/api/disconnect", {
      method: "POST",
      headers: connHeaders(),
    });
  } catch (_) {
    // ignore
  } finally {
    state.disconnecting = false;
  }
  resetEditing();

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
