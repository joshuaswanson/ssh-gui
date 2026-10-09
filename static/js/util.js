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

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// A JS string literal that can sit inside a double-quoted HTML attribute.
function jsAttr(value) {
  return escapeHtml(JSON.stringify(value));
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

// ── Notifications and Layout ─────────────────────────────────────────

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

// ── Clipboard ────────────────────────────────────────────────────────

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showNotification("Copied to clipboard", "success");
  });
}
