const locks = new Map();
const lastRun = new Map();

export function isLocked(name) {
  return locks.has(name);
}

export function markJob(name, extra = {}) {
  lastRun.set(name, { at: new Date().toISOString(), ...extra });
}

export function getJobStatus() {
  return Object.fromEntries(lastRun);
}

export async function withLock(name, fn) {
  if (locks.has(name)) return { skipped: true };
  locks.set(name, Date.now());
  try {
    const result = await fn();
    markJob(name, { skipped: false });
    return result;
  } catch (err) {
    markJob(name, { error: err.message });
    throw err;
  } finally {
    locks.delete(name);
  }
}
