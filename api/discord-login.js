const crypto = require("crypto");

const { getClientIp } = require("./_shared");

const STATE_TTL_SECONDS = 10 * 60;

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;

  return `${proto}://${host}`;
}

function stateSecret() {
  return process.env.DISCORD_STATE_SECRET || process.env.ADMIN_KEY || process.env.DISCORD_CLIENT_SECRET || "";
}

function signState(payload) {
  const secret = stateSecret();

  if (!secret) {
    throw new Error("DISCORD_STATE_SECRET or ADMIN_KEY is not configured");
  }

  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createState(ip) {
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomBytes(16).toString("base64url"),
    ip,
    issued: Math.floor(Date.now() / 1000)
  })).toString("base64url");

  return `${payload}.${signState(payload)}`;
}

function callbackUrl(req) {
  return process.env.DISCORD_REDIRECT_URI || `${getBaseUrl(req)}/api/discord-callback`;
}

function cookieSecurity(req) {
  return String(req.headers["x-forwarded-proto"] || "https") === "https" ? "; Secure" : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (!process.env.DISCORD_CLIENT_ID) {
      res.status(500).send("DISCORD_CLIENT_ID is not configured");
      return;
    }

    const state = createState(getClientIp(req));
    const url = new URL("https://discord.com/oauth2/authorize");

    url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID);
    url.searchParams.set("redirect_uri", callbackUrl(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);

    res.setHeader(
      "Set-Cookie",
      `vw_discord_state=${encodeURIComponent(state)}; HttpOnly${cookieSecurity(req)}; SameSite=Lax; Path=/; Max-Age=${STATE_TTL_SECONDS}`
    );
    res.statusCode = 302;
    res.setHeader("Location", url.toString());
    res.end();
  } catch (error) {
    res.status(500).send(error?.message || "discord login failed");
  }
};
