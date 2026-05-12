const {
  getClientIp,
  logAttempt,
  readState,
  writeState
} = require("./_shared");

async function handleVerify(req, res) {
  const providedKey = String(req.query.key || req.headers["x-script-key"] || "").trim();
  const clientIp = getClientIp(req);

  if (!providedKey) {
    await logAttempt(req, "verify-missing-key");
    res.status(200).send("DENY:missing-key");
    return;
  }

  const state = await readState();
  const record = state.keys.find((item) => item.key === providedKey);

  if (!record) {
    await logAttempt(req, "verify-invalid-key", providedKey);
    res.status(200).send("DENY:invalid-key");
    return;
  }

  if (!record.active) {
    await logAttempt(req, "verify-revoked-key", providedKey);
    res.status(200).send("DENY:revoked-key");
    return;
  }

  if (record.ip !== clientIp) {
    await logAttempt(req, "verify-wrong-ip", providedKey);
    res.status(200).send("DENY:wrong-ip");
    return;
  }

  record.lastUsedAt = new Date().toISOString();
  await writeState(state);

  res.status(200).send(`ALLOW:${clientIp}`);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  try {
    await handleVerify(req, res);
  } catch (error) {
    res.status(200).send(`DENY:server-error:${error?.message || "unknown"}`);
  }
};
