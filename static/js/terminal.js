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
    state.terminalEnded = false;

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
    // A reconnect starts a plain shell, so drop tmux's mouse reporting mode.
    if (state.terminal) state.terminal.reset();
    state.terminalEnded = false;
    state.tmux.inTmux = false;
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

  state.socket.on("terminal_closed", () => {
    if (!state.terminal) return;
    if (state.tmux.inTmux) {
      openShell();
      return;
    }
    state.terminalEnded = true;
    state.terminal.write(
      "\r\n\x1b[2m[Session ended. Press Enter to start a new shell.]\x1b[0m\r\n",
    );
  });

  if (state.terminal) {
    state.terminal.onData((data) => {
      if (!state.socket) return;
      if (state.terminalEnded) {
        if (data === "\r") openShell();
        return;
      }
      state.socket.emit("terminal_input", { data });
    });

    state.terminal.onResize(({ cols, rows }) => {
      if (state.socket) state.socket.emit("terminal_resize", { cols, rows });
    });
  }
}

function openShell() {
  if (!state.socket || !state.terminal) return;
  state.terminal.reset();
  state.socket.emit("terminal_switch", {
    connection_id: state.connectionId,
    cols: state.terminal.cols,
    rows: state.terminal.rows,
  });
  state.terminalEnded = false;
  state.tmux.inTmux = false;
  renderTmuxBar();
}

function currentDirPath() {
  for (let i = state.columns.length - 1; i >= 0; i--) {
    if (state.columns[i].path) return state.columns[i].path;
  }
  return null;
}

function shellQuote(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function cdToBrowserPath() {
  const path = currentDirPath();
  if (!state.terminal || !state.socket || !path || state.terminalEnded) return;
  state.socket.emit("terminal_input", {
    data: "cd " + shellQuote(path) + "\n",
  });
  state.terminal.focus();
}

// ── Terminal Click-to-Move ────────────────────────────────────────────

function setupTerminalClickHandler(term) {
  // Clicking on the cursor's row moves the cursor there with arrow keys.
  term.element.addEventListener("click", (e) => {
    if (!state.socket || state.terminalEnded) return;
    if (term.hasSelection()) return;
    // The program in the terminal handles its own mouse clicks.
    if (term.modes.mouseTrackingMode !== "none") return;

    const screen = term.element.querySelector(".xterm-screen");
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const clickCol = Math.floor((e.clientX - rect.left) / (rect.width / term.cols));
    const clickRow = Math.floor((e.clientY - rect.top) / (rect.height / term.rows));

    const buffer = term.buffer.active;
    if (clickRow !== buffer.cursorY) return;
    const diff = clickCol - buffer.cursorX;
    if (diff === 0) return;

    const arrow = diff > 0 ? "\x1b[C" : "\x1b[D";
    state.socket.emit("terminal_input", { data: arrow.repeat(Math.abs(diff)) });
  });
}

// ── Tmux GUI ─────────────────────────────────────────────────────────

function startTmuxPolling() {
  if (state.tmux.pollInterval) return;
  refreshTmuxState();
  state.tmux.pollInterval = setInterval(refreshTmuxState, 3000);
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
  if (document.hidden) return;
  const connId = state.connectionId;
  try {
    const resp = await fetch("/api/tmux/state", { headers: connHeaders() });
    const data = await resp.json();
    if (!resp.ok || connId !== state.connectionId) return;

    state.tmux.active = data.active;
    state.tmux.session = data.session;

    if (!data.active) {
      state.tmux.windows = [];
      state.tmux.panes = [];
      const bar = document.getElementById("tmux-bar");
      if (bar) bar.classList.add("hidden");
      return;
    }

    state.tmux.windows = data.windows || [];
    state.tmux.panes = data.panes || [];
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

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "tmux-tabs";

  // Shell tab (plain terminal, not attached to tmux)
  const shellTab = document.createElement("div");
  shellTab.className = "tmux-tab" + (!state.tmux.inTmux ? " active" : "");
  shellTab.innerHTML = `<span class="tmux-tab-label">Shell</span>`;
  shellTab.addEventListener("click", () => {
    if (state.tmux.inTmux) openShell();
  });
  tabs.appendChild(shellTab);

  // Tmux window tabs
  state.tmux.windows.forEach((win) => {
    const tab = document.createElement("div");
    tab.className =
      "tmux-tab" + (state.tmux.inTmux && win.active ? " active" : "");
    tab.innerHTML = `<span class="tmux-tab-label">${escapeHtml(win.name)}</span>`;
    tab.addEventListener("click", () => {
      if (!state.tmux.inTmux && state.socket && state.terminal) {
        // Switch to tmux by opening a new channel attached to tmux
        state.terminal.reset();
        state.socket.emit("terminal_switch", {
          connection_id: state.connectionId,
          tmux_session: state.tmux.session,
          tmux_window: win.index,
          cols: state.terminal.cols,
          rows: state.terminal.rows,
        });
        state.tmux.inTmux = true;
        state.terminalEnded = false;
      } else {
        tmuxSelectWindow(win.index);
      }
      renderTmuxBar();
    });
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
    await fetch("/api/tmux/new-window", {
      method: "POST",
      headers: connHeaders(),
    });
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
