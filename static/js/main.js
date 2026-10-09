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
  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedEdits()) e.preventDefault();
  });
}
