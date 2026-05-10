const keyInput = document.querySelector("#admin-key");
const loadButton = document.querySelector("#load-state");
const saveButton = document.querySelector("#save-script");
const scriptInput = document.querySelector("#script-body");
const scriptState = document.querySelector("#script-state");
const attemptsEl = document.querySelector("#attempts");
const keysEl = document.querySelector("#keys");
const generatedKey = document.querySelector("#generated-key");

keyInput.value = sessionStorage.getItem("adminKey") || "";

function adminKey() {
  return keyInput.value.trim();
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
  const data = await response.json();

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
  await loadState();
}

async function revokeKey(key) {
  await api("revoke", {
    method: "POST",
    body: JSON.stringify({ key })
  });
  await loadState();
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
        <small>${item.status} · ${new Date(item.at).toLocaleString()}</small>
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
        <small>${item.active ? "active" : "revoked"} · uses ${item.uses || 0}</small>
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

async function loadState() {
  sessionStorage.setItem("adminKey", adminKey());
  const data = await api("state");

  scriptState.textContent = data.hasScript
    ? `Stored script length: ${data.scriptLength} bytes`
    : "No script body stored yet.";

  renderAttempts(data.attempts || []);
  renderKeys(data.keys || []);
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

  scriptState.textContent = `Saved script length: ${data.length} bytes`;
  scriptInput.value = "";
}

loadButton.addEventListener("click", () => {
  loadState().catch((error) => {
    scriptState.textContent = error.message;
  });
});

saveButton.addEventListener("click", () => {
  saveScript().catch((error) => {
    scriptState.textContent = error.message;
  });
});
