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
  if (e.target.id === "editor-textarea") {
    handleEditorKey(e);
    return;
  }
  if (e.target.closest("input, textarea")) return;
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
      if (fc > 0 && confirmDiscardEdits()) {
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

// ── Global Keyboard Shortcuts ────────────────────────────────────────

function setupGlobalShortcuts() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        const overlays = document.querySelectorAll(".modal-overlay");
        if (overlays.length > 0) {
          e.preventDefault();
          overlays[overlays.length - 1].remove();
          state.quickLook = { active: false, path: null };
          return;
        }
      }

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
        if (col && col.path) createEntry(col.path, "folder");
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
      <input id="goto-input" class="modal-input" type="text" value="${escapeHtml(currentPath)}" placeholder="/path/to/directory" />
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
