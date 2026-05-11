const crypto = require("crypto");

const STATE_PATH = "venom-host/state.json";
const SCRIPT_PATH = "venom-host/script.lua";
const MAX_ATTEMPTS = 250;
const MAX_ADMIN_LOGIN_ATTEMPTS = 4;
const ADMIN_LOGIN_WINDOW_MS = 60 * 60 * 1000;
const SCRIPT_RATE_LIMIT_PER_DAY = 50;
const SCRIPT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

let dbPoolPromise;
let dbReadyPromise;

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

function pruneAdminLogins(state, nowMs) {
  state.adminLogins = Array.isArray(state.adminLogins) ? state.adminLogins : [];
  state.adminLogins = state.adminLogins.filter((item) => {
    const atMs = Date.parse(item.at || "");
    return Number.isFinite(atMs) && nowMs - atMs <= ADMIN_LOGIN_WINDOW_MS;
  });
}

async function getDbPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!dbPoolPromise) {
    dbPoolPromise = Promise.all([
      import("@neondatabase/serverless"),
      import("ws")
    ]).then(([{ Pool, neonConfig }, wsModule]) => {
      neonConfig.webSocketConstructor = wsModule.default || wsModule.WebSocket || wsModule;
      return new Pool({
        connectionString: process.env.DATABASE_URL
      });
    });
  }

  return dbPoolPromise;
}

async function dbQuery(text, params) {
  const pool = await getDbPool();
  return pool.query(text, params);
}

async function ensureDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS attempts (
          id TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          status TEXT NOT NULL,
          key_hint TEXT DEFAULT '',
          user_agent TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await dbQuery("CREATE INDEX IF NOT EXISTS attempts_created_at_idx ON attempts (created_at)");
      await dbQuery("CREATE INDEX IF NOT EXISTS attempts_ip_idx ON attempts (ip)");
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS script_requests (
          id TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await dbQuery("CREATE INDEX IF NOT EXISTS script_requests_ip_created_idx ON script_requests (ip, created_at)");
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS access_keys (
          key TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          note TEXT DEFAULT '',
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          revoked_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ,
          uses INTEGER NOT NULL DEFAULT 0
        )
      `);
      await dbQuery("CREATE INDEX IF NOT EXISTS access_keys_ip_idx ON access_keys (ip)");
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS admin_logins (
          id TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          status TEXT NOT NULL,
          user_agent TEXT DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await dbQuery("CREATE INDEX IF NOT EXISTS admin_logins_ip_created_idx ON admin_logins (ip, created_at)");
    })().catch((error) => {
      dbReadyPromise = null;
      throw error;
    });
  }

  return dbReadyPromise;
}

async function getScriptRateLimit(ip) {
  await ensureDb();

  const since = new Date(Date.now() - SCRIPT_RATE_WINDOW_MS);
  const result = await dbQuery(`
    SELECT COUNT(*)::int AS count
    FROM script_requests
    WHERE ip = $1 AND created_at >= $2
  `, [ip, since]);
  const count = Number(result.rows[0]?.count || 0);

  return {
    count,
    limit: SCRIPT_RATE_LIMIT_PER_DAY,
    remaining: Math.max(0, SCRIPT_RATE_LIMIT_PER_DAY - count)
  };
}

async function recordScriptRequest(ip) {
  await ensureDb();

  await dbQuery(`
    INSERT INTO script_requests (id, ip, created_at)
    VALUES ($1, $2, now())
  `, [crypto.randomUUID(), ip]);
  await dbQuery(`
    DELETE FROM script_requests
    WHERE created_at < now() - interval '3 days'
  `);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : "";
}

function toDateOrNull(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

async function requireAdmin(req, res) {
  const expected = process.env.ADMIN_KEY;
  const provided = getAdminKey(req);
  const ip = getClientIp(req);

  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured" });
    return false;
  }

  const state = await readState();
  const nowMs = Date.now();

  pruneAdminLogins(state, nowMs);

  const failures = state.adminLogins.filter((item) => item.ip === ip && item.status === "failed").length;

  if (failures >= MAX_ADMIN_LOGIN_ATTEMPTS) {
    await writeState(state);
    res.status(429).json({ ok: false, error: "too many admin login attempts, try again later" });
    return false;
  }

  if (!provided || provided !== expected) {
    state.adminLogins.push({
      ip,
      status: "failed",
      at: new Date(nowMs).toISOString(),
      userAgent: req.headers["user-agent"] || ""
    });
    await writeState(state);
    res.status(401).json({ ok: false, error: "invalid admin key" });
    return false;
  }

  state.adminLogins = state.adminLogins.filter((item) => item.ip !== ip || item.status !== "failed");
  state.adminLogins.push({
    ip,
    status: "success",
    at: new Date(nowMs).toISOString(),
    userAgent: req.headers["user-agent"] || ""
  });
  await writeState(state);

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
    keys: [],
    adminLogins: []
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
  await ensureDb();

  const [attemptsResult, keysResult, adminLoginsResult] = await Promise.all([
    dbQuery(`
      SELECT id, ip, status, key_hint, user_agent, created_at
      FROM (
        SELECT id, ip, status, key_hint, user_agent, created_at
        FROM attempts
        ORDER BY created_at DESC
        LIMIT $1
      ) recent_attempts
      ORDER BY created_at ASC
    `, [MAX_ATTEMPTS]),
    dbQuery(`
      SELECT key, ip, note, active, created_at, revoked_at, last_used_at, uses
      FROM access_keys
      ORDER BY created_at ASC
    `),
    dbQuery(`
      SELECT id, ip, status, user_agent, created_at
      FROM (
        SELECT id, ip, status, user_agent, created_at
        FROM admin_logins
        ORDER BY created_at DESC
        LIMIT $1
      ) recent_logins
      ORDER BY created_at ASC
    `, [MAX_ATTEMPTS])
  ]);

  return {
    attempts: attemptsResult.rows.map((item) => ({
      id: item.id,
      ip: item.ip,
      status: item.status,
      key: item.key_hint || "",
      userAgent: item.user_agent || "",
      at: toIso(item.created_at)
    })),
    keys: keysResult.rows.map((item) => ({
      key: item.key,
      ip: item.ip,
      note: item.note || "",
      active: item.active !== false,
      createdAt: toIso(item.created_at),
      revokedAt: toIso(item.revoked_at),
      lastUsedAt: toIso(item.last_used_at),
      uses: Number(item.uses || 0)
    })),
    adminLogins: adminLoginsResult.rows.map((item) => ({
      id: item.id,
      ip: item.ip,
      status: item.status,
      userAgent: item.user_agent || "",
      at: toIso(item.created_at)
    }))
  };
}

async function writeState(state) {
  await ensureDb();

  const cleanState = {
    attempts: Array.isArray(state.attempts) ? state.attempts.slice(-MAX_ATTEMPTS) : [],
    keys: Array.isArray(state.keys) ? state.keys : [],
    adminLogins: Array.isArray(state.adminLogins) ? state.adminLogins.slice(-MAX_ATTEMPTS) : []
  };
  const pool = await getDbPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM admin_logins");
    await client.query("DELETE FROM attempts");
    await client.query("DELETE FROM access_keys");

    for (const item of cleanState.attempts) {
      await client.query(`
        INSERT INTO attempts (id, ip, status, key_hint, user_agent, created_at)
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
      `, [
        item.id || crypto.randomUUID(),
        String(item.ip || ""),
        String(item.status || "pending"),
        String(item.key || ""),
        String(item.userAgent || ""),
        toDateOrNull(item.at)
      ]);
    }

    for (const item of cleanState.keys) {
      await client.query(`
        INSERT INTO access_keys (key, ip, note, active, created_at, revoked_at, last_used_at, uses)
        VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7, $8)
      `, [
        String(item.key || ""),
        String(item.ip || ""),
        String(item.note || ""),
        item.active !== false,
        toDateOrNull(item.createdAt),
        toDateOrNull(item.revokedAt),
        toDateOrNull(item.lastUsedAt),
        Number(item.uses || 0)
      ]);
    }

    for (const item of cleanState.adminLogins) {
      await client.query(`
        INSERT INTO admin_logins (id, ip, status, user_agent, created_at)
        VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))
      `, [
        item.id || crypto.randomUUID(),
        String(item.ip || ""),
        String(item.status || "failed"),
        String(item.userAgent || ""),
        toDateOrNull(item.at)
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  getScriptRateLimit,
  readScriptBody,
  readState,
  recordScriptRequest,
  requireAdmin,
  writeScriptBody,
  writeState,
  logAttempt
};
