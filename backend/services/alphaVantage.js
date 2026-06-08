import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const KEY = process.env.ALPHA_VANTAGE_KEY || '';
const BASE = 'https://www.alphavantage.co/query';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => {
    if (data) cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

// Free tier: max 1 request/second — serialize all calls through a queue.
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1200;
const queue = [];
let draining = false;

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drainQueue();
  });
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { fn, resolve, reject } = queue.shift();
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    }
  }
  draining = false;
}

async function get(params) {
  if (!KEY) return null;
  return schedule(async () => {
    try {
      const res = await axios.get(BASE, { params: { ...params, apikey: KEY }, timeout: 12000 });
      const data = res.data;
      if (data?.Note || data?.Information) return null; // rate limit / throttle message
      if (data?.['Error Message']) return null;
      return data;
    } catch {
      return null;
    }
  });
}

function fromGlobalQuote(symbol, q) {
  if (!q) return null;
  const price = parseFloat(q['05. price']);
  const change = parseFloat(q['09. change']);
  const changePct = parseFloat(String(q['10. change percent'] || '0').replace('%', ''));
  if (!price) return null;
  return {
    symbol,
    price,
    change,
    changePct,
    open: parseFloat(q['02. open']) || null,
    previousClose: parseFloat(q['08. previous close']) || null,
    dayHigh: parseFloat(q['03. high']) || null,
    dayLow: parseFloat(q['04. low']) || null,
    volume: parseInt(q['06. volume'], 10) || null
  };
}

function fromDailySeries(series) {
  if (!series) return null;
  return Object.entries(series)
    .map(([date, row]) => ({
      date,
      open: parseFloat(row['1. open']),
      high: parseFloat(row['2. high']),
      low: parseFloat(row['3. low']),
      close: parseFloat(row['4. close']),
      volume: parseInt(row['5. volume'], 10) || 0
    }))
    .filter(c => c.close && c.open && c.high && c.low)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getQuote(symbol) {
  return cached(`av_quote_${symbol}`, 90_000, async () => {
    const data = await get({ function: 'GLOBAL_QUOTE', symbol });
    return fromGlobalQuote(symbol, data?.['Global Quote']);
  });
}

export async function getHistorical(symbol, days = 100) {
  // Free tier only supports outputsize=compact (~100 most recent trading days);
  // outputsize=full is a premium feature. Cache the FULL parsed series (unsliced)
  // so different requested ranges slice from the same dataset instead of colliding
  // on a shared cache key and returning a previously-sliced (wrong-length) array.
  const series = await cached(`av_hist_${symbol}`, 20 * 60_000, async () => {
    const data = await get({ function: 'TIME_SERIES_DAILY', symbol, outputsize: 'compact' });
    return fromDailySeries(data?.['Time Series (Daily)']);
  });
  if (!series?.length) return null;
  return series.slice(-days);
}
