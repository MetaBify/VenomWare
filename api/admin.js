const {
  generateKey,
  readFreeScriptBody,
  readScriptBody,
  readState,
  readTestScriptBody,
  requireAdmin,
  writeFreeScriptBody,
  writeScriptBody,
  writeTestScriptBody,
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
    const testScriptBody = await readTestScriptBody();
    const freeScriptBody = await readFreeScriptBody();

    res.status(200).json({
      ok: true,
      ...normalizeStateForClient(state),
      hasScript: scriptBody.length > 0,
      scriptLength: scriptBody.length,
      hasTestScript: testScriptBody.length > 0,
      testScriptLength: testScriptBody.length,
      hasFreeScript: freeScriptBody.length > 0,
      freeScriptLength: freeScriptBody.length
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

  if (req.method === "GET" && action === "testScript") {
    const testScriptBody = await readTestScriptBody();

    res.status(200).json({
      ok: true,
      script: testScriptBody,
      length: testScriptBody.length
    });
    return;
  }

  if (req.method === "GET" && action === "freeScript") {
    const freeScriptBody = await readFreeScriptBody();

    res.status(200).json({
      ok: true,
      script: freeScriptBody,
      length: freeScriptBody.length
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
    const note = String(body.note || "").trim();

    if (!ip) {
      res.status(400).json({ ok: false, error: "missing ip" });
      return;
    }

    const existing = state.keys.find((item) => item.ip === ip && item.active);

    if (existing) {
      if (note) {
        existing.note = note;
        await writeState(state);
      }

      res.status(200).json({
        ok: true,
        key: existing.key,
        ip,
        ...normalizeStateForClient(state)
      });
      return;
    }

    const key = generateKey();
    const now = new Date().toISOString();

    state.keys.push({
      key,
      ip,
      note,
      active: true,
      createdAt: now,
      lastUsedAt: "",
      uses: 0
    });

    await writeState(state);
    res.status(200).json({
      ok: true,
      key,
      ip,
      ...normalizeStateForClient(state)
    });
    return;
  }

  if (action === "note") {
    const key = String(body.key || "");
    const record = state.keys.find((item) => item.key === key);

    if (!record) {
      res.status(404).json({ ok: false, error: "key not found" });
      return;
    }

    record.note = String(body.note || "").trim();
    await writeState(state);
    res.status(200).json({
      ok: true,
      ...normalizeStateForClient(state)
    });
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
    res.status(200).json({
      ok: true,
      ...normalizeStateForClient(state)
    });
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
    res.status(200).json({
      ok: true,
      count,
      ...normalizeStateForClient(state)
    });
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

  if (action === "testScript") {
    const script = String(body.script || "");

    if (!script.trim()) {
      res.status(400).json({ ok: false, error: "missing test script" });
      return;
    }

    await writeTestScriptBody(script);
    res.status(200).json({ ok: true, length: script.length });
    return;
  }

  if (action === "freeScript") {
    const script = String(body.script || "");

    if (!script.trim()) {
      res.status(400).json({ ok: false, error: "missing free script" });
      return;
    }

    await writeFreeScriptBody(script);
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
