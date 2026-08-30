import { AppError } from './errors.js';

const TICKER_RE = /^[A-Z0-9^=.-]{1,16}$/;
const INVALID = new Set(['NULL', 'UNDEFINED', 'NONE', '']);

export function normalizeTicker(raw) {
  if (raw == null) return null;
  const t = decodeURIComponent(String(raw)).trim().toUpperCase();
  if (!t || INVALID.has(t) || !TICKER_RE.test(t)) return null;
  return t;
}

export function requireTicker(raw) {
  const t = normalizeTicker(raw);
  if (!t) throw new AppError('Invalid ticker', 400, 'BAD_TICKER');
  return t;
}

export function parseSymbols(raw, { max = 40 } = {}) {
  const list = String(raw ?? '')
    .split(',')
    .map(s => normalizeTicker(s))
    .filter(Boolean);
  return [...new Set(list)].slice(0, max);
}

export function clampInt(raw, { min, max, fallback }) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
