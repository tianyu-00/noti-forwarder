// Small in-memory fixed-window limiter. Fine for a single server process.
export function rateLimit({ limit, windowMs, key, now = Date.now }) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))));
      return res.status(429).json({ error: 'rate_limited' });
    }
    // Drop expired entries occasionally so the map cannot grow without bound.
    if (hits.size > 10000) {
      for (const [id, e] of hits) if (t >= e.resetAt) hits.delete(id);
    }
    next();
  };
}
