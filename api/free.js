const { readFreeScriptBody } = require("./_shared");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  try {
    const body = await readFreeScriptBody();

    if (!body) {
      res.status(500).send("-- free script body is not configured");
      return;
    }

    res.status(200).send(body);
  } catch (error) {
    res.status(500).send(`-- server error: ${error?.message || "unknown error"}`);
  }
};
