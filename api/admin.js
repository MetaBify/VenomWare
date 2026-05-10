const {
  generateKey,
  readScriptBody,
  readState,
  requireAdmin,
  writeScriptBody,
  writeState
} = require("./_shared");

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeStateForClient(state) {
  return {
    attempts: state.attempts.slice().reverse(),
    keys: state.keys.slice().reverse()
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!requireAdmin(req, res)) {
    return;
  }

  const action = req.query.action || "state";

  if (req.method === "GET" && action === "state") {
    const state = await readState();
    const scriptBody = await readScriptBody();

    res.status(200).json({
      ok: true,
      ...normalizeStateForClient(state),
      hasScript: scriptBody.length > 0,
      scriptLength: scriptBody.length
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  const body = await readJson(req);
  const state = await readState();

  if (action === "approve") {
    const ip = String(body.ip || "").trim();

    if (!ip) {
      res.status(400).json({ ok: false, error: "missing ip" });
      return;
    }

    const key = generateKey();
    const now = new Date().toISOString();

    state.keys.push({
      key,
      ip,
      note: String(body.note || ""),
      active: true,
      createdAt: now,
      lastUsedAt: "",
      uses: 0
    });

    await writeState(state);
    res.status(200).json({ ok: true, key, ip });
    return;
  }

  if (action === "revoke") {
    const key = String(body.key || "");
    const record = state.keys.find((item) => item.key === key);

    if (!record) {
      res.status(404).json({ ok: false, error: "key not found" });
      return;
    }

    record.active = false;
    record.revokedAt = new Date().toISOString();
    await writeState(state);
    res.status(200).json({ ok: true });
    return;
  }

  if (action === "script") {
    const script = String(body.script || "");

    if (!script.trim()) {
      res.status(400).json({ ok: false, error: "missing script" });
      return;
    }

    await writeScriptBody(script);
    res.status(200).json({ ok: true, length: script.length });
    return;
  }

  res.status(404).json({ ok: false, error: "unknown action" });
};
