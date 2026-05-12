const loginPanel = document.querySelector("#login-panel");
const adminPanel = document.querySelector("#admin-panel");
const loginForm = document.querySelector("#login-form");
const keyInput = document.querySelector("#admin-key");
const loginState = document.querySelector("#login-state");
const refreshButton = document.querySelector("#refresh-state");
const logoutButton = document.querySelector("#logout-button");
const saveButton = document.querySelector("#save-script");
const loadScriptButton = document.querySelector("#load-script");
const saveFreeButton = document.querySelector("#save-free-script");
const loadFreeScriptButton = document.querySelector("#load-free-script");
const revokeAllButton = document.querySelector("#revoke-all");
const revokeAllConfirm = document.querySelector("#revoke-all-confirm");
const scriptInput = document.querySelector("#script-body");
const scriptState = document.querySelector("#script-state");
const freeScriptInput = document.querySelector("#free-script-body");
const freeScriptState = document.querySelector("#free-script-state");
const freeLoader = document.querySelector("#free-loader");
const attemptsEl = document.querySelector("#attempts");
const keysEl = document.querySelector("#keys");
const approvedUsersEl = document.querySelector("#approved-users");
const generatedKey = document.querySelector("#generated-key");

let currentAdminKey = sessionStorage.getItem("adminKey") || "";

function setLoggedIn(loggedIn) {
  loginPanel.classList.toggle("is-hidden", loggedIn);
  adminPanel.classList.toggle("is-hidden", !loggedIn);
}

function adminKey() {
  return currentAdminKey;
}

function freeLoaderText() {
  return `loadstring(game:HttpGet("${new URL("/api/free", window.location.origin).toString()}"))()`;
}

async function api(action, options = {}) {
  const response = await fetch(`/api/admin?action=${encodeURIComponent(action)}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey(),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(data.error || "request failed");
  }

  return data;
}

function row(html) {
  const div = document.createElement("div");
  div.className = "list-row";
  div.innerHTML = html;
  return div;
}

async function copyText(value, button) {
  const original = button.textContent;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    button.textContent = "copied";
  } catch {
    button.textContent = "copy failed";
  }

  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

function keyBox(key) {
  return `
    <span class="key-box">
      <code>${escapeHtml(key)}</code>
      <button class="copy-key" type="button">copy</button>
    </span>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function approveIp(ip, note) {
  const data = await api("approve", {
    method: "POST",
    body: JSON.stringify({ ip, note })
  });

  generatedKey.value = data.key;
  await navigator.clipboard?.writeText(data.key).catch(() => {});
  renderState(data);
  scriptState.textContent = `Approved ${data.ip}${note ? ` for ${note}` : ""}. Generated key copied if browser allowed it.`;
}

async function saveUsername(key, note) {
  const data = await api("note", {
    method: "POST",
    body: JSON.stringify({ key, note })
  });

  renderState(data);
  scriptState.textContent = note ? `Saved username: ${note}.` : "Username cleared.";
}

async function revokeKey(key) {
  const data = await api("revoke", {
    method: "POST",
    body: JSON.stringify({ key })
  });
  renderState(data);
  scriptState.textContent = "Key revoked.";
}

async function revokeAllKeys() {
  if (!revokeAllConfirm.checked) {
    scriptState.textContent = "Check confirm before revoking all keys.";
    return;
  }

  const data = await api("revokeAll", {
    method: "POST",
    body: JSON.stringify({ confirm: true })
  });

  revokeAllConfirm.checked = false;
  revokeAllButton.disabled = true;
  renderState(data);
  scriptState.textContent = `Revoked ${data.count} active key(s).`;
}

function renderAttempts(attempts, approvedUsers) {
  attemptsEl.replaceChildren();

  const pendingByIp = new Map();
  const approvedIps = new Set((approvedUsers || []).map((item) => item.ip));

  for (const item of attempts) {
    if (approvedIps.has(item.ip)) {
      continue;
    }

    if (item.status === "pending" && !pendingByIp.has(item.ip)) {
      pendingByIp.set(item.ip, item);
    }
  }

  const pending = [...pendingByIp.values()];

  if (!pending.length) {
    const empty = document.createElement("div");
    empty.className = "pending-row empty-row";
    empty.textContent = "No pending IPs.";
    attemptsEl.append(empty);
    return;
  }

  for (const item of pending) {
    const el = document.createElement("div");
    el.className = "pending-row";
    el.innerHTML = `
      <span class="pending-main">
        <strong>approve ${escapeHtml(item.ip)}</strong>
        <small>requested ${new Date(item.at).toLocaleString()}</small>
      </span>
      <input class="pending-user" placeholder="username">
      <button type="button">Approve</button>
    `;
    const input = el.querySelector("input");
    el.querySelector("button").addEventListener("click", () => approveIp(item.ip, input.value.trim()));
    attemptsEl.append(el);
  }
}

function renderKeys(keys) {
  keysEl.replaceChildren();

  if (!keys.length) {
    keysEl.append(row("<span>No keys yet.</span>"));
    return;
  }

  for (const item of keys) {
    const el = row(`
      <div class="key-meta">
        <strong>${escapeHtml(item.note || "No username")}</strong>
        <small>${escapeHtml(item.ip)}</small>
        <small>${item.active ? "active" : "revoked"} - uses ${item.uses || 0}</small>
        ${keyBox(item.key)}
      </div>
      <button type="button">${item.active ? "Revoke" : "Revoked"}</button>
    `);
    el.classList.add("key-row");
    const button = el.querySelector(":scope > button");
    el.querySelector(".copy-key").addEventListener("click", () => copyText(item.key, el.querySelector(".copy-key")));
    button.disabled = !item.active;
    button.addEventListener("click", () => revokeKey(item.key));
    keysEl.append(el);
  }
}

function renderApprovedUsers(users) {
  approvedUsersEl.replaceChildren();

  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "approved-row empty-row";
    empty.textContent = "No approved users yet.";
    approvedUsersEl.append(empty);
    return;
  }

  for (const item of users) {
    const el = document.createElement("div");
    el.className = "approved-row";
    el.innerHTML = `
        <input class="approved-user-input" value="${escapeHtml(item.note || "")}" placeholder="username">
        <span class="approved-ip">${escapeHtml(item.ip)}</span>
        ${keyBox(item.key)}
        <span class="approved-stats">
          req ${item.requestCount || 0} / use ${item.uses || 0}
          <small>approved ${new Date(item.createdAt).toLocaleString()}</small>
          ${item.lastUsedAt ? `<small>last use ${new Date(item.lastUsedAt).toLocaleString()}</small>` : ""}
        </span>
        <span class="approved-actions">
          <button class="save-user" type="button">save user</button>
          <button class="revoke-user" type="button">revoke whitelist</button>
        </span>
    `;
    const input = el.querySelector(".approved-user-input");
    el.querySelector(".copy-key").addEventListener("click", () => copyText(item.key, el.querySelector(".copy-key")));
    el.querySelector(".save-user").addEventListener("click", () => saveUsername(item.key, input.value.trim()));
    el.querySelector(".revoke-user").addEventListener("click", () => revokeKey(item.key));
    approvedUsersEl.append(el);
  }
}

function renderState(data) {
  if ("hasScript" in data) {
    scriptState.textContent = data.hasScript
      ? `Stored script length: ${data.scriptLength} bytes`
      : "No script body stored yet.";
  }

  renderAttempts(data.attempts || [], data.approvedUsers || []);
  freeScriptState.textContent = data.hasFreeScript
    ? `Stored free script length: ${data.freeScriptLength} bytes`
    : "No free script body stored yet.";
  freeLoader.value = freeLoaderText();

  renderApprovedUsers(data.approvedUsers || []);
  renderKeys(data.keys || []);
}

async function loadState() {
  const data = await api("state");
  renderState(data);
}

async function login(password) {
  currentAdminKey = password.trim();
  loginState.textContent = "Checking...";

  await loadState();

  sessionStorage.setItem("adminKey", currentAdminKey);
  keyInput.value = "";
  loginState.textContent = "4 failed attempts per IP are allowed each hour.";
  setLoggedIn(true);
}

function logout() {
  currentAdminKey = "";
  sessionStorage.removeItem("adminKey");
  generatedKey.value = "";
  scriptInput.value = "";
  freeScriptInput.value = "";
  freeLoader.value = "";
  attemptsEl.replaceChildren();
  keysEl.replaceChildren();
  approvedUsersEl.replaceChildren();
  revokeAllConfirm.checked = false;
  revokeAllButton.disabled = true;
  setLoggedIn(false);
}

async function loadStoredScript() {
  const data = await api("script");

  scriptInput.value = data.script || "";
  scriptState.textContent = data.length
    ? `Loaded stored script length: ${data.length} bytes`
    : "No stored script body yet.";
}

async function loadStoredFreeScript() {
  const data = await api("freeScript");

  freeScriptInput.value = data.script || "";
  freeScriptState.textContent = data.length
    ? `Loaded free script length: ${data.length} bytes`
    : "No free script body yet.";
  freeLoader.value = freeLoaderText();
}

async function saveScript() {
  const script = scriptInput.value;

  if (!script.trim()) {
    scriptState.textContent = "Paste script body before saving.";
    return;
  }

  const data = await api("script", {
    method: "POST",
    body: JSON.stringify({ script })
  });

  scriptState.textContent = `Saved script length: ${data.length} bytes. Previous script was replaced.`;
  scriptInput.value = "";
}

async function saveFreeScript() {
  const script = freeScriptInput.value;

  if (!script.trim()) {
    freeScriptState.textContent = "Paste free script body before saving.";
    return;
  }

  const data = await api("freeScript", {
    method: "POST",
    body: JSON.stringify({ script })
  });

  freeScriptState.textContent = `Saved free script length: ${data.length} bytes. Public endpoint was replaced.`;
  freeLoader.value = freeLoaderText();
  freeScriptInput.value = "";
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  login(keyInput.value).catch((error) => {
    currentAdminKey = "";
    sessionStorage.removeItem("adminKey");
    loginState.textContent = error.message;
    setLoggedIn(false);
  });
});

refreshButton.addEventListener("click", () => {
  loadState().catch((error) => {
    scriptState.textContent = error.message;
  });
});

logoutButton.addEventListener("click", logout);

saveButton.addEventListener("click", () => {
  saveScript().catch((error) => {
    scriptState.textContent = error.message;
  });
});

loadScriptButton.addEventListener("click", () => {
  loadStoredScript().catch((error) => {
    scriptState.textContent = error.message;
  });
});

saveFreeButton.addEventListener("click", () => {
  saveFreeScript().catch((error) => {
    freeScriptState.textContent = error.message;
  });
});

loadFreeScriptButton.addEventListener("click", () => {
  loadStoredFreeScript().catch((error) => {
    freeScriptState.textContent = error.message;
  });
});

revokeAllConfirm.addEventListener("change", () => {
  revokeAllButton.disabled = !revokeAllConfirm.checked;
});

revokeAllButton.addEventListener("click", () => {
  revokeAllKeys().catch((error) => {
    scriptState.textContent = error.message;
  });
});

if (currentAdminKey) {
  login(currentAdminKey).catch(() => logout());
} else {
  setLoggedIn(false);
}
