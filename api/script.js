const {
  fakeLua,
  getClientIp,
  logAttempt,
  readScriptBody,
  readState,
  writeState
} = require("./_shared");

module.exports = async function handler(req, res) {
  const providedKey = req.query.key || req.headers["x-script-key"];
  const clientIp = getClientIp(req);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  if (!providedKey) {
    await logAttempt(req, "pending");
    res.status(200).send(fakeLua(clientIp));
    return;
  }

  const state = await readState();
  const record = state.keys.find((item) => item.key === providedKey);

  if (!record) {
    await logAttempt(req, "invalid-key", providedKey);
    res.status(403).send("-- invalid key");
    return;
  }

  if (!record.active) {
    await logAttempt(req, "revoked-key", providedKey);
    res.status(403).send("-- key revoked");
    return;
  }

  if (record.ip !== clientIp) {
    await logAttempt(req, "wrong-ip", providedKey);
    res.status(403).send("-- key is not valid for this IP");
    return;
  }

  const body = await readScriptBody();

  if (!body) {
    res.status(500).send("-- script body is not configured");
    return;
  }

  record.lastUsedAt = new Date().toISOString();
  record.uses = (record.uses || 0) + 1;
  await writeState(state);

  res.status(200).send(body);
};
