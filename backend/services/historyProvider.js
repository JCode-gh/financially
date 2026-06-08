// Unified historical-candle provider with a persistent disk cache.
//
// Why this exists: no single FREE data source is reliable on its own.
//   - Twelve Data (free key) → multi-year daily history, 800 req/day. PRIMARY.
//   - Yahoo Finance (no key) → 400 days, but rate-limits aggressively.
//   - Alpha Vantage (free key) → ~100 days only (free tier compact cap).
//
// Strategy: fetch the deepest series any source will give, MERGE it into a
// per-symbol JSON file on disk, and serve every chart range by slicing that
// file. Depth accumulates over time and survives restarts + rate-limits, so
// once we capture a full year (from Twelve Data or a healthy Yahoo), 6M/1Y keep
// working even when every live source is temporarily down.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getHistorical as getYahoo } from './yahooFinance.js';
import { getHistorical as getTwelve } from './twelveData.js';
import { getHistorical as getAlpha } from './alphaVantage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'history');

const FRESH_MS = 20 * 60_000; // skip live fetch if disk cache is younger than this
const MAX_DAYS = 5000;        // deepest window we ever request / store (~20y for zoom-out)

function ensureDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
}

function fileFor(symbol) {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

export function readHistory(symbol) {
  try {
    const obj = JSON.parse(fs.readFileSync(fileFor(symbol), 'utf8'));
    return obj?.candles?.length ? obj : null;
  } catch {
    return null;
  }
}

function writeHistory(symbol, candles) {
  if (!candles?.length) return;
  ensureDir();
  const payload = { symbol: symbol.toUpperCase(), fetchedAt: Date.now(), candles };
  try { fs.writeFileSync(fileFor(symbol), JSON.stringify(payload)); } catch { /* ignore */ }
}

// Merge a freshly fetched series into the persisted one.
// - If the fresh series is at least as deep, it's a clean full series → use it.
// - If it's shallower (e.g. AV's 100 days) but newer, stitch: keep the older
//   cached candles and overlay the fresh recent ones (preserves depth, stays current).
function mergeHistory(symbol, fresh) {
  const existing = readHistory(symbol)?.candles || [];
  if (!fresh?.length) return existing.length ? existing : null;

  if (fresh.length >= existing.length) {
    writeHistory(symbol, fresh);
    return fresh;
  }

  const byDate = new Map();
  for (const c of existing) byDate.set(c.date, c);
  for (const c of fresh) byDate.set(c.date, c); // fresh overwrites same-date candles
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  writeHistory(symbol, merged);
  return merged;
}

// Fetch the deepest series available, trying sources in priority order.
async function fetchDeepest(symbol) {
  // Twelve Data first — most reliable free multi-year source (no-op without key).
  let live = await getTwelve(symbol, MAX_DAYS).catch(() => null);
  if (live?.length) return live;

  // Yahoo Finance — keyless, full 400 days when not rate-limited.
  live = await getYahoo(symbol, MAX_DAYS).catch(() => null);
  if (live?.length) return live;

  // Alpha Vantage — free tier, ~100 most-recent days.
  live = await getAlpha(symbol, MAX_DAYS).catch(() => null);
  if (live?.length) return live;

  return null;
}

/**
 * Get daily OHLCV candles for a symbol, sliced to the requested number of days.
 * Serves from the persistent disk cache when it's fresh and deep enough; otherwise
 * fetches the deepest live series, merges it to disk, and slices that.
 * Returns null only when no source and no cache can provide any data.
 */
export async function getHistoricalSeries(symbol, days = 100) {
  symbol = symbol.toUpperCase();

  const disk = readHistory(symbol);
  const isFresh = disk && Date.now() - disk.fetchedAt < FRESH_MS;
  if (isFresh && disk.candles.length >= days) {
    return disk.candles.slice(-days);
  }

  let full;
  try {
    const live = await fetchDeepest(symbol);
    full = mergeHistory(symbol, live);
  } catch {
    full = disk?.candles || null;
  }

  if (!full?.length) full = disk?.candles || null;
  if (!full?.length) return null;
  return full.slice(-days);
}
