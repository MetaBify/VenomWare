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
  const requestCounts = state.attempts.reduce((counts, item) => {
    counts[item.ip] = (counts[item.ip] || 0) + 1;
    return counts;
  }, {});
  const keys = state.keys.map((item) => ({
    ...item,
    requestCount: requestCounts[item.ip] || 0
  }));

  return {
    attempts: state.attempts.slice().reverse(),
    keys: keys.slice().reverse(),
    approvedUsers: keys.filter((item) => item.active).slice().reverse()
  };
}

async function handleAdmin(req, res) {
  if (!(await requireAdmin(req, res))) {
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

  if (req.method === "GET" && action === "script") {
    const scriptBody = await readScriptBody();

    res.status(200).json({
      ok: true,
      script: scriptBody,
      length: scriptBody.length
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

  if (action === "revokeAll") {
    if (body.confirm !== true) {
      res.status(400).json({ ok: false, error: "missing revoke-all confirmation" });
      return;
    }

    const now = new Date().toISOString();
    let count = 0;

    for (const record of state.keys) {
      if (record.active) {
        record.active = false;
        record.revokedAt = now;
        count += 1;
      }
    }

    await writeState(state);
    res.status(200).json({ ok: true, count });
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
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  try {
    await handleAdmin(req, res);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || "server error",
      name: error?.name || "Error"
    });
  }
};
