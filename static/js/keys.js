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
          ${k.has_pub ? `<button class="btn btn-sm btn-edit" onclick="copyPublicKey(${jsAttr(k.name)})">Copy Public Key</button>` : ""}
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
