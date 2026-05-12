const crypto = require("crypto");

const {
  getClientIp,
  logAttempt,
  readState,
  writeState
} = require("./_shared");

const TOKEN_TTL_SECONDS = 180;
const SIGN_A = "vw-session-a:7c2f2d91";
const SIGN_B = "vw-session-b:51a89e04";

function authSignature(...parts) {
  const input = `${SIGN_A}|${parts.map((part) => String(part || "")).join("|")}|${SIGN_B}`;
  let hash = 2166136261 % 2147483647;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash = (hash + code * ((index % 251) + 1) + SIGN_B.charCodeAt(index % SIGN_B.length)) % 2147483647;
    hash = (hash * 131 + index * 17 + 97) % 2147483647;
  }

  return Math.floor(hash).toString(16).padStart(8, "0");
}

function issueToken(key) {
  const issued = Math.floor(Date.now() / 1000);
  const expires = issued + TOKEN_TTL_SECONDS;
  const nonce = crypto.randomBytes(12).toString("base64url");
  const signature = authSignature(key, issued, expires, nonce);

  return `VW1:${issued}:${expires}:${nonce}:${signature}`;
}

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

  res.status(200).send(issueToken(providedKey));
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
