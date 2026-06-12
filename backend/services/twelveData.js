import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://api.twelvedata.com';
const KEY = process.env.TWELVE_DATA_KEY || '';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => {
    if (data) cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

// Twelve Data uses dot notation for share classes (BRK.B), while the rest of the
// app uses Yahoo's dash notation (BRK-B). Normalize for TD requests only.
function toTdSymbol(symbol) {
  return symbol.replace(/-/g, '.');
}

// Parse a Twelve Data time_series response into our candle shape.
// Daily rows are 'YYYY-MM-DD'; intraday rows are 'YYYY-MM-DD HH:MM:SS'.
function parseSeries(data) {
  if (!data || data.status === 'error' || !Array.isArray(data.values)) return null;
  return data.values
    .map(v => ({
      date: v.datetime,
      open: parseFloat(parseFloat(v.open).toFixed(4)),
      high: parseFloat(parseFloat(v.high).toFixed(4)),
      low: parseFloat(parseFloat(v.low).toFixed(4)),
      close: parseFloat(parseFloat(v.close).toFixed(4)),
      volume: parseInt(v.volume, 10) || 0
    }))
    .filter(c => c.close && c.open && c.high && c.low)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Daily OHLCV history. Free tier returns multi-year history (outputsize up to 5000),
// which makes it the reliable source for long ranges (6M/1Y/5Y) that Yahoo
// (rate-limited) and Alpha Vantage (free tier caps at ~100 days) cannot serve.
export async function getHistorical(symbol, days = 100) {
  if (!KEY) return null;
  // Twelve Data rarely lists EU exchange tickers — skip to preserve quota.
  if (/\.[A-Z]{1,4}$/.test(symbol)) return null;
  // Cache the full fetched series (unsliced) and slice per request so each timeframe
  // gets its own window from one upstream call.
  const series = await cached(`td_hist_${symbol}`, 20 * 60_000, async () => {
    try {
      const res = await axios.get(`${BASE}/time_series`, {
        params: { symbol: toTdSymbol(symbol), interval: '1day', outputsize: 5000, order: 'ASC', apikey: KEY },
        timeout: 15000
      });
      return parseSeries(res.data);
    } catch {
      return null;
    }
  });
  if (!series?.length) return null;
  return series.slice(-days);
}

// Intraday OHLCV (e.g. '1h', '30min'). Memory-cached only ~2 min — intraday moves,
// so it must NOT go in the persistent disk cache. Returns the most recent `outputsize` bars.
export async function getIntraday(symbol, interval = '1h', outputsize = 500) {
  if (!KEY) return null;
  const series = await cached(`td_intra_${symbol}_${interval}`, 2 * 60_000, async () => {
    try {
      const res = await axios.get(`${BASE}/time_series`, {
        params: { symbol: toTdSymbol(symbol), interval, outputsize, order: 'ASC', apikey: KEY },
        timeout: 15000
      });
      return parseSeries(res.data);
    } catch {
      return null;
    }
  });
  return series?.length ? series : null;
}
