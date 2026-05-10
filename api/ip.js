function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const ip = (rawIp || req.socket?.remoteAddress || "").split(",")[0].trim();

  return ip.replace(/^::ffff:/, "");
}

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({ ip: getClientIp(req) });
};
