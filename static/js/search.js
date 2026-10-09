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
    <input id="search-input" type="text" placeholder="Filter files. Press Enter to search subfolders." value="${escapeHtml(state.search.query)}" />
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
    } else if (e.key === "Enter") {
      e.preventDefault();
      searchSubfolders(bar);
    }
    e.stopPropagation();
  });
  input.focus();
}

async function searchSubfolders(anchorEl) {
  const query = state.search.query.trim();
  const root = currentDirPath();
  if (!query || !root) return;

  showNotification(`Searching ${root}...`, "info");
  let data;
  try {
    data = await cachedPost(
      "/api/search",
      { path: root, query, hidden: state.showHidden },
      30000,
    );
  } catch (e) {
    showNotification("Search failed: " + e.message, "error");
    return;
  }
  if (data.error) {
    showNotification(data.error, "error");
    return;
  }

  hideContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu search-results";
  menu.id = "context-menu";

  const count = data.results.length;
  const header = document.createElement("div");
  header.className = "search-results-header";
  header.textContent =
    count === 0
      ? `No matches under ${root}`
      : `${count}${data.truncated ? "+" : ""} match${count === 1 ? "" : "es"} under ${root}`;
  menu.appendChild(header);

  data.results.forEach((result) => {
    const el = document.createElement("div");
    el.className = "context-menu-item";
    const icon = result.is_dir ? FOLDER_ICON : FILE_ICON;
    const relativeParent = result.parent.slice(root.length).replace(/^\//, "");
    el.innerHTML = `<span class="ctx-icon">${icon}</span><span class="search-result-name">${escapeHtml(result.name)}</span><span class="search-result-path">${escapeHtml(relativeParent)}</span>`;
    el.addEventListener("click", () => {
      hideContextMenu();
      revealEntry(result.parent, result.name);
    });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = rect.left + 8 + "px";
  menu.style.top = rect.bottom + 2 + "px";
  registerContextMenuDismiss();
}

async function revealEntry(parentPath, name) {
  if (state.search.active) toggleSearchBar();
  if (name.startsWith(".") && !state.showHidden) {
    state.showHidden = true;
    document.getElementById("hidden-toggle").checked = true;
  }
  await navigateTo(parentPath);
  const column = state.columns[0];
  const entry =
    column && column.path === parentPath
      ? column.entries.find((e) => e.name === name)
      : null;
  if (!entry) return;
  await selectEntry(0, entry);
  scrollEntryIntoView(
    0,
    getVisibleEntries(column).findIndex((e) => e.name === name),
  );
  focusColumns();
}
