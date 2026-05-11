const loginPanel = document.querySelector("#login-panel");
const adminPanel = document.querySelector("#admin-panel");
const loginForm = document.querySelector("#login-form");
const keyInput = document.querySelector("#admin-key");
const loginState = document.querySelector("#login-state");
const refreshButton = document.querySelector("#refresh-state");
const logoutButton = document.querySelector("#logout-button");
const saveButton = document.querySelector("#save-script");
const loadScriptButton = document.querySelector("#load-script");
const revokeAllButton = document.querySelector("#revoke-all");
const revokeAllConfirm = document.querySelector("#revoke-all-confirm");
const scriptInput = document.querySelector("#script-body");
const scriptState = document.querySelector("#script-state");
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

async function approveIp(ip) {
  const data = await api("approve", {
    method: "POST",
    body: JSON.stringify({ ip })
  });

  generatedKey.value = data.key;
  await navigator.clipboard?.writeText(data.key).catch(() => {});
  renderState(data);
  scriptState.textContent = `Approved ${data.ip}. Generated key copied if browser allowed it.`;
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

function renderAttempts(attempts) {
  attemptsEl.replaceChildren();

  if (!attempts.length) {
    attemptsEl.append(row("<span>No requests yet.</span>"));
    return;
  }

  for (const item of attempts) {
    const el = row(`
      <div>
        <strong>${item.ip}</strong>
        <small>${item.status} - ${new Date(item.at).toLocaleString()}</small>
      </div>
      <button type="button">Approve</button>
    `);
    el.querySelector("button").addEventListener("click", () => approveIp(item.ip));
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
      <div>
        <strong>${item.ip}</strong>
        <small>${item.active ? "active" : "revoked"} - uses ${item.uses || 0}</small>
        <code>${item.key}</code>
      </div>
      <button type="button">${item.active ? "Revoke" : "Revoked"}</button>
    `);
    const button = el.querySelector("button");
    button.disabled = !item.active;
    button.addEventListener("click", () => revokeKey(item.key));
    keysEl.append(el);
  }
}

function renderApprovedUsers(users) {
  approvedUsersEl.replaceChildren();

  if (!users.length) {
    approvedUsersEl.append(row("<span>No approved users yet.</span>"));
    return;
  }

  for (const item of users) {
    const el = row(`
      <div>
        <strong>${item.ip}</strong>
        <small>requests ${item.requestCount || 0} - script uses ${item.uses || 0}</small>
        <code>key: ${item.key}</code>
      </div>
      <button type="button">Revoke</button>
    `);
    el.querySelector("button").addEventListener("click", () => revokeKey(item.key));
    approvedUsersEl.append(el);
  }
}

function renderState(data) {
  if ("hasScript" in data) {
    scriptState.textContent = data.hasScript
      ? `Stored script length: ${data.scriptLength} bytes`
      : "No script body stored yet.";
  }

  renderAttempts(data.attempts || []);
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
