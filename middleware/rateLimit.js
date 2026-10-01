// Simple in-memory rate limiter for Express (no extra dependency).
// Counts requests per client IP in a fixed time window. Good enough for a
// single server instance; use a shared store (e.g. Redis) if you run several.
// skipSuccessful: only failed responses (status >= 400) count towards the limit.
function rateLimit({ windowMs, max, message, skipSuccessful = false }) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Drop expired entries now and then so the map can't grow forever
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    if (skipSuccessful) {
      res.on('finish', () => {
        if (res.statusCode < 400) entry.count -= 1;
      });
    }
    next();
  };
}

module.exports = rateLimit;
