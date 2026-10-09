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
      venvOptions += `<option value="${escapeHtml(v)}"${selected}>${escapeHtml(name)}</option>`;
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
          <button class="package-uninstall" onclick="uninstallPackage(${jsAttr(p.name)})">Remove</button>
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
      <input type="text" placeholder="Filter packages..." value="${escapeHtml(state.packagePanel.filter)}" oninput="state.packagePanel.filter = this.value; renderPackagePanel();" />
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
