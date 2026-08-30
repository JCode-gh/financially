export function createTtlCache() {
  const cache = new Map();
  const inflight = new Map();

  function cached(key, ttlMs, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
    if (inflight.has(key)) return inflight.get(key);

    const p = Promise.resolve()
      .then(fn)
      .then(data => {
        if (data != null) cache.set(key, { data, ts: Date.now() });
        return data;
      })
      .catch(err => {
        const stale = cache.get(key);
        if (stale) return stale.data;
        throw err;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  }

  return { cached, cache };
}

export async function pLimit(tasks, limit = 4, delayMs = 0) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...settled.map(r => (r.status === 'fulfilled' ? r.value : null)));
    if (delayMs && i + limit < tasks.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}
