const crypto = require("crypto");

const {
  getClientIp,
  grantDiscordKey,
  logAttempt
} = require("./_shared");

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

function parseCookies(req) {
  const header = req.headers.cookie || "";

  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");

    if (index === -1) {
      return cookies;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);

    return cookies;
  }, {});
}

function readState(req, receivedState) {
  const cookieState = parseCookies(req).vw_discord_state;

  if (!receivedState || !cookieState || receivedState !== cookieState) {
    throw new Error("discord state check failed");
  }

  const [payload, signature] = receivedState.split(".");
  const expected = signState(payload);

  if (!signature || signature !== expected) {
    throw new Error("discord state signature failed");
  }

  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const age = Math.floor(Date.now() / 1000) - Number(state.issued || 0);

  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_SECONDS) {
    throw new Error("discord login expired");
  }

  return state;
}

function callbackUrl(req) {
  return process.env.DISCORD_REDIRECT_URI || `${getBaseUrl(req)}/api/discord-callback`;
}

function cookieSecurity(req) {
  return String(req.headers["x-forwarded-proto"] || "https") === "https" ? "; Secure" : "";
}

function allowedRoleIds() {
  return String(process.env.DISCORD_ALLOWED_ROLE_IDS || process.env.DISCORD_ROLE_ID || "")
    .split(/[,\s]+/)
    .map((role) => role.trim())
    .filter(Boolean);
}

function discordName(user) {
  if (user.global_name) {
    return `${user.global_name} (${user.username})`;
  }

  return user.discriminator && user.discriminator !== "0"
    ? `${user.username}#${user.discriminator}`
    : user.username;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loaderFor(req, key) {
  const scriptUrl = new URL("/api/script", getBaseUrl(req));
  const verifyUrl = new URL("/api/verify", getBaseUrl(req));

  scriptUrl.searchParams.set("null", key);

  return `getgenv().key=${JSON.stringify(key)};getgenv().venom_auth_verify_url=${JSON.stringify(verifyUrl.toString())};loadstring(game:HttpGet(${JSON.stringify(scriptUrl.toString())}))()`;
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="icon" type="image/png" href="/assets/logo.png">
  <link rel="apple-touch-icon" href="/assets/logo.png">
  <link rel="stylesheet" href="/site.css">
</head>
<body>
  <main class="shell">
    <section class="panel home-panel">
      ${body}
    </section>
  </main>
</body>
</html>`;
}

async function exchangeCode(req, code) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Discord OAuth is not configured");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(req)
  });
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Discord token exchange failed");
  }

  return data.access_token;
}

async function getDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Discord user lookup failed");
  }

  return data;
}

async function getGuildMember(userId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  if (!guildId || !botToken) {
    throw new Error("Discord bot role check is not configured");
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: { authorization: `Bot ${botToken}` }
  });
  const data = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(data.message || "Discord guild member lookup failed");
  }

  return data;
}

function isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$)/.test(ip);
}

async function checkIpRisk(ip) {
  const apiKey = process.env.PROXYCHECK_API_KEY;

  if (!apiKey || isPrivateIp(ip)) {
    return { ok: true, checked: false };
  }

  const riskLimit = Number(process.env.VPN_RISK_LIMIT || 66);
  const url = new URL(`https://proxycheck.io/v2/${encodeURIComponent(ip)}`);

  url.searchParams.set("key", apiKey);
  url.searchParams.set("vpn", "1");
  url.searchParams.set("asn", "1");
  url.searchParams.set("risk", "1");

  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status === "error") {
    throw new Error(data.message || "IP risk check failed");
  }

  const record = data[ip] || {};
  const risk = Number(record.risk || 0);

  if (record.proxy === "yes" || risk >= riskLimit) {
    return {
      ok: false,
      checked: true,
      reason: `vpn/proxy risk ${risk}`
    };
  }

  return { ok: true, checked: true, risk };
}

function successBody({ key, loader, ip, username, created }) {
  return `
    <div class="brand">
      <div class="mark"><img src="/assets/logo.png" alt="Venom Ware logo"></div>
      <div>
        <h1>Access Ready</h1>
        <p>${created ? "Generated a new key" : "Found your existing key"} for ${escapeHtml(username)}.</p>
      </div>
    </div>
    <section class="tutorial">
      <h2>Your key</h2>
      <textarea readonly spellcheck="false">${escapeHtml(key)}</textarea>
      <h2>Your keyed loader</h2>
      <textarea readonly spellcheck="false">${escapeHtml(loader)}</textarea>
      <p class="status-text">Locked to IP ${escapeHtml(ip)}. If you switch VPNs or networks, verify again.</p>
      <a class="button-link" href="/">Back to generator</a>
    </section>
  `;
}

function errorBody(message) {
  return `
    <div class="brand">
      <div class="mark"><img src="/assets/logo.png" alt="Venom Ware logo"></div>
      <div>
        <h1>Access Denied</h1>
        <p>${escapeHtml(message)}</p>
      </div>
    </div>
    <a class="button-link" href="/">Back to generator</a>
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Set-Cookie", `vw_discord_state=; HttpOnly${cookieSecurity(req)}; SameSite=Lax; Path=/; Max-Age=0`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const clientIp = getClientIp(req);

  try {
    const state = readState(req, String(req.query.state || ""));

    if (state.ip !== clientIp) {
      await logAttempt(req, "discord-ip-changed");
      res.status(403).send(htmlPage("Access Denied", errorBody("Your IP changed during Discord verification.")));
      return;
    }

    const ipRisk = await checkIpRisk(clientIp);

    if (!ipRisk.ok) {
      await logAttempt(req, "discord-vpn-denied");
      res.status(403).send(htmlPage("Access Denied", errorBody("VPN or proxy traffic is not allowed for key generation.")));
      return;
    }

    const code = String(req.query.code || "");

    if (!code) {
      throw new Error("missing Discord code");
    }

    const roles = allowedRoleIds();

    if (!roles.length) {
      throw new Error("DISCORD_ROLE_ID or DISCORD_ALLOWED_ROLE_IDS is not configured");
    }

    const accessToken = await exchangeCode(req, code);
    const user = await getDiscordUser(accessToken);
    const member = await getGuildMember(user.id);

    if (!member) {
      await logAttempt(req, "discord-not-in-guild");
      res.status(403).send(htmlPage("Access Denied", errorBody("Join the Discord server before generating a key.")));
      return;
    }

    const hasRole = Array.isArray(member.roles) && member.roles.some((role) => roles.includes(role));

    if (!hasRole) {
      await logAttempt(req, "discord-missing-role");
      res.status(403).send(htmlPage("Access Denied", errorBody("Your Discord account does not have the required role.")));
      return;
    }

    const username = discordName(user);
    const grant = await grantDiscordKey({
      ip: clientIp,
      discordId: user.id,
      discordUsername: username
    });

    await logAttempt(req, "discord-approved", grant.key);
    res.status(200).send(htmlPage("Access Ready", successBody({
      key: grant.key,
      loader: loaderFor(req, grant.key),
      ip: clientIp,
      username,
      created: grant.created
    })));
  } catch (error) {
    await logAttempt(req, "discord-error").catch(() => {});
    res.status(500).send(htmlPage("Access Error", errorBody(error?.message || "Discord verification failed.")));
  }
};
