const crypto = require("crypto");

const STATE_PATH = "venom-host/state.json";
const SCRIPT_PATH = "venom-host/script.lua";
const MAX_ATTEMPTS = 250;

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ip = (rawIp || req.socket?.remoteAddress || "").split(",")[0].trim();

  return ip.replace(/^::ffff:/, "");
}

function generateKey() {
  return crypto.randomBytes(24).toString("base64url");
}

function getAdminKey(req) {
  return req.headers["x-admin-key"] || req.query.admin_key;
}

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_KEY;
  const provided = getAdminKey(req);

  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured" });
    return false;
  }

  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: "invalid admin key" });
    return false;
  }

  return true;
}

async function getBlobSdk() {
  return import("@vercel/blob");
}

async function streamToText(stream) {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function emptyState() {
  return {
    attempts: [],
    keys: []
  };
}

async function readTextBlob(pathname) {
  const { get } = await getBlobSdk();

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || !result.stream) {
      return null;
    }

    return streamToText(result.stream);
  } catch (error) {
    if (error?.name === "BlobNotFoundError" || /not found/i.test(String(error?.message || ""))) {
      return null;
    }

    throw error;
  }
}

async function writeTextBlob(pathname, body, contentType) {
  const { put } = await getBlobSdk();

  await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentType || "text/plain; charset=utf-8",
    cacheControlMaxAge: 60
  });
}

async function readState() {
  const text = await readTextBlob(STATE_PATH);

  if (!text) {
    return emptyState();
  }

  try {
    const state = JSON.parse(text);
    state.attempts = Array.isArray(state.attempts) ? state.attempts : [];
    state.keys = Array.isArray(state.keys) ? state.keys : [];
    return state;
  } catch {
    return emptyState();
  }
}

async function writeState(state) {
  const cleanState = {
    attempts: Array.isArray(state.attempts) ? state.attempts.slice(-MAX_ATTEMPTS) : [],
    keys: Array.isArray(state.keys) ? state.keys : []
  };

  await writeTextBlob(STATE_PATH, JSON.stringify(cleanState, null, 2), "application/json; charset=utf-8");
}

async function logAttempt(req, status, key) {
  const state = await readState();
  const now = new Date().toISOString();
  const ip = getClientIp(req);

  state.attempts.push({
    id: crypto.randomUUID(),
    ip,
    status,
    key: key ? String(key).slice(0, 8) + "..." : "",
    userAgent: req.headers["user-agent"] || "",
    at: now
  });

  await writeState(state);
  return ip;
}

async function readScriptBody() {
  const blobBody = await readTextBlob(SCRIPT_PATH);

  if (blobBody) {
    return blobBody;
  }

  if (process.env.SCRIPT_BODY_BASE64) {
    return Buffer.from(process.env.SCRIPT_BODY_BASE64, "base64").toString("utf8");
  }

  return process.env.SCRIPT_BODY || "";
}

async function writeScriptBody(body) {
  await writeTextBlob(SCRIPT_PATH, body, "text/plain; charset=utf-8");
}

function fakeLua(ip) {
  const message = `Venom Ware: access pending for IP ${ip}. Contact admin for approval.`;

  return [
    "-- access pending",
    `warn(${JSON.stringify(message)})`
  ].join("\n");
}

module.exports = {
  SCRIPT_PATH,
  STATE_PATH,
  fakeLua,
  generateKey,
  getClientIp,
  readScriptBody,
  readState,
  requireAdmin,
  writeScriptBody,
  writeState,
  logAttempt
};
