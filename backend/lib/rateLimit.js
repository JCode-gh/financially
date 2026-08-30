export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'local';
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests — try again shortly',
        code: 'RATE_LIMIT'
      });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
