import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'history');

// Yahoo Finance requires a session cookie + crumb for authenticated endpoints.
// The v8/finance/chart endpoint works without auth; v7/finance/quote needs crumb.
// Strategy: initialize session once, reuse. Fall back to chart API if quota exceeded.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE1 = 'https://query1.finance.yahoo.com';
const BASE2 = 'https://query2.finance.yahoo.com';

const http = axios.create({ timeout: 12000 });

let session = { cookie: '', crumb: '', ts: 0 };
const SESSION_TTL = 60 * 60 * 1000; // 1 hour

// Global backoff: when Yahoo rate-limits us (429), stop hitting it for a while
// so the IP-level throttle can clear instead of being re-triggered on every call.
let backoffUntil = 0;
const BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

function yahooBlocked() {
  return Date.now() < backoffUntil;
}

function noteYahooError(e) {
  const status = e?.response?.status;
  if (status === 429 || status === 999) {
    backoffUntil = Date.now() + BACKOFF_MS;
    session.ts = 0; // force fresh session once backoff clears
  }
}

// Wrapper around http.get that short-circuits while rate-limited and records 429s.
async function yget(url, opts) {
  if (yahooBlocked()) {
    const err = new Error('yahoo-backoff');
    err.code = 'YAHOO_BACKOFF';
    throw err;
  }
  try {
    return await http.get(url, opts);
  } catch (e) {
    noteYahooError(e);
    throw e;
  }
}

async function ensureSession() {
  if (session.crumb && Date.now() - session.ts < SESSION_TTL) return;
  if (yahooBlocked()) return; // don't refresh session while rate-limited

  try {
    // Step 1: visit main page to get A3 consent cookie
    const r1 = await yget('https://finance.yahoo.com', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      maxRedirects: 5
    });
    const cookies1 = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // Step 2: consent if redirected to consent page
    let cookieStr = cookies1;
    if (r1.request?.res?.responseUrl?.includes('consent')) {
      try {
        const r1b = await http.post('https://consent.yahoo.com/v2/collectConsent', null, {
          headers: { 'User-Agent': UA, 'Cookie': cookieStr, 'Content-Type': 'application/x-www-form-urlencoded' },
          params: { sessionId: r1b?.data?.match(/sessionId=([^&"]+)/)?.[1] || '' }
        });
        cookieStr += '; ' + (r1b.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      } catch { /* ignore consent errors */ }
    }

    // Step 3: get crumb
    const r2 = await yget(`${BASE2}/v1/test/getcrumb`, {
      headers: { 'User-Agent': UA, 'Cookie': cookieStr, 'Accept': '*/*' }
    });

    if (r2.data && typeof r2.data === 'string') {
      session = { cookie: cookieStr, crumb: r2.data.trim(), ts: Date.now() };
    }
  } catch { /* session will be empty, fall back to chart API */ }
}

// In-memory cache
const cache = new Map();
// Dedupe concurrent requests for the same key so a single page load (market +
// watchlist + historical + quote firing at once) doesn't fan out into a storm.
const inflight = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);

  const p = fn()
    .then(data => { if (data) cache.set(key, { data, ts: Date.now() }); return data; })
    .catch(() => { const stale = cache.get(key); return stale ? stale.data : null; })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

async function pLimit(tasks, limit = 4, batchDelayMs = 300) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const res = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...res.map(r => r.status === 'fulfilled' ? r.value : null));
    if (batchDelayMs > 0 && i + limit < tasks.length) await new Promise(r => setTimeout(r, batchDelayMs));
  }
  return results;
}

const DISK_QUOTE_FRESH_MS = 20 * 60_000;

function quoteFromDisk(symbol, { maxAgeMs } = {}) {
  const safe = symbol.toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '_');
  try {
    const disk = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${safe}.json`), 'utf8'));
    if (!disk?.candles?.length) return null;
    if (maxAgeMs != null && Date.now() - disk.fetchedAt > maxAgeMs) return null;
    const last = disk.candles[disk.candles.length - 1];
    const prev = disk.candles.length > 1 ? disk.candles[disk.candles.length - 2] : last;
    const change = last.close - prev.close;
    return {
      symbol: disk.symbol || symbol.toUpperCase(),
      price: last.close,
      change,
      changePct: prev.close ? (change / prev.close) * 100 : 0,
      previousClose: prev.close,
      open: last.open,
      dayHigh: last.high,
      dayLow: last.low,
      volume: last.volume,
      stale: true
    };
  } catch {
    return null;
  }
}

async function fetchUsQuotes(symbols) {
  const bulk = await quoteBulk(symbols);
  if (bulk?.length) return bulk.map(fromV7Quote);
  return (await pLimit(symbols.map(sym => () => getQuote(sym)), 6, 150)).filter(Boolean);
}

async function fetchIntlQuotes(symbols) {
  const results = [];
  const needLive = [];
  for (const sym of symbols) {
    const cached = quoteFromDisk(sym, { maxAgeMs: DISK_QUOTE_FRESH_MS });
    if (cached) results.push(cached);
    else needLive.push(sym);
  }
  if (needLive.length) {
    const live = await pLimit(needLive.map(sym => () => quoteViaChart(sym)), 6, 150);
    results.push(...live.filter(Boolean));
  }
  return results;
}

// Primary: v7 bulk quote (needs crumb)
async function quoteBulk(symbols) {
  await ensureSession();
  if (!session.crumb) return null;
  try {
    const res = await yget(`${BASE2}/v7/finance/quote`, {
      params: { symbols: symbols.join(','), crumb: session.crumb },
      headers: { 'User-Agent': UA, 'Cookie': session.cookie, 'Accept': '*/*' }
    });
    return res.data?.quoteResponse?.result || null;
  } catch (e) {
    if (e.response?.status === 401) session.ts = 0;
    return null;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function chartUrl(base, symbol, params) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  );
  return `${base}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`;
}

const CURL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Yahoo often 429s Node.js HTTP clients; shell curl works reliably on macOS/Linux.
async function curlChartJson(url) {
  if (!/^https:\/\/query[12]\.finance\.yahoo\.com\//.test(url)) return null;
  try {
    const { stdout } = await execAsync(
      `curl -s -L --max-time 30 -H 'User-Agent: ${CURL_UA}' -H 'Referer: https://finance.yahoo.com/' ${shellQuote(url)}`,
      { maxBuffer: 12 * 1024 * 1024 }
    );
    const text = stdout?.trim();
    if (!text || text.startsWith('Too Many')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getChartJson(symbol, params) {
  for (const base of [BASE1, BASE2]) {
    const data = await curlChartJson(chartUrl(base, symbol, params));
    if (data?.chart?.result?.[0]) return data;
  }
  // Railway/containers often lack curl — fall back to axios
  for (const base of [BASE1, BASE2]) {
    try {
      const res = await yget(chartUrl(base, symbol, params), {
        headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://finance.yahoo.com/' }
      });
      if (res.data?.chart?.result?.[0]) return res.data;
    } catch { /* try next base */ }
  }
  return null;
}

// Fallback: v8 chart for single symbol (no auth required)
async function chartMeta(symbol) {
  const data = await getChartJson(symbol, { range: '5d', interval: '1d', includePrePost: false });
  return data?.chart?.result?.[0] ?? null;
}

function parseChartCandles(data) {
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;
  const { timestamp, indicators } = result;
  const q = indicators.quote[0];
  return timestamp
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: q.open[i] != null ? parseFloat(q.open[i].toFixed(4)) : null,
      high: q.high[i] != null ? parseFloat(q.high[i].toFixed(4)) : null,
      low: q.low[i] != null ? parseFloat(q.low[i].toFixed(4)) : null,
      close: q.close[i] != null ? parseFloat(q.close[i].toFixed(4)) : null,
      volume: q.volume[i] || 0
    }))
    .filter(c => c.close && c.open && c.high && c.low);
}

// Daily OHLCV via the public chart API (curl avoids Yahoo's Node.js 429 blocks).
async function fetchChartDaily(symbol) {
  for (const range of ['1y', '2y', '5y', '6mo', '3mo', '10y']) {
    const data = await getChartJson(symbol, { range, interval: '1d', includePrePost: false });
    const parsed = parseChartCandles(data);
    if (parsed?.length) return parsed;
  }
  return null;
}

function fromChartMeta(meta, name, type) {
  if (!meta) return null;
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose || meta.chartPreviousClose;
  return {
    symbol: meta.symbol,
    name: name || meta.longName || meta.shortName,
    type: type || meta.instrumentType,
    price,
    change: price - prev,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    open: meta.regularMarketOpen,
    previousClose: prev,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    marketCap: meta.marketCap,
    pe: null,
    week52High: meta.fiftyTwoWeekHigh,
    week52Low: meta.fiftyTwoWeekLow,
    exchange: meta.exchangeName
  };
}

function fromV7Quote(q) {
  return {
    symbol: q.symbol,
    name: q.longName || q.shortName,
    price: q.regularMarketPrice,
    change: q.regularMarketChange,
    changePct: q.regularMarketChangePercent,
    open: q.regularMarketOpen,
    previousClose: q.regularMarketPreviousClose,
    dayHigh: q.regularMarketDayHigh,
    dayLow: q.regularMarketDayLow,
    volume: q.regularMarketVolume,
    avgVolume: q.averageDailyVolume3Month,
    marketCap: q.marketCap,
    pe: q.trailingPE,
    eps: q.epsTrailingTwelveMonths,
    week52High: q.fiftyTwoWeekHigh,
    week52Low: q.fiftyTwoWeekLow,
    beta: q.beta,
    exchange: q.fullExchangeName
  };
}

// Euronext Brussels (ABI.BR), Amsterdam (INGA.AS), etc. — v7 bulk often omits these;
// the chart endpoint handles them reliably.
function isInternationalTicker(symbol) {
  return /^[A-Z0-9-]+\.[A-Z]{1,4}$/.test(symbol) && !symbol.startsWith('^');
}

async function quoteViaChart(symbol) {
  const data = await getChartJson(symbol, { range: '5d', interval: '1d', includePrePost: false });
  const result = data?.chart?.result?.[0];
  if (result?.meta?.regularMarketPrice != null) return fromChartMeta(result.meta, null, null);
  return null;
}

const MARKET_META = [
  { symbol: '^GSPC', name: 'S&P 500', type: 'index' },
  { symbol: '^DJI', name: 'Dow Jones', type: 'index' },
  { symbol: '^IXIC', name: 'NASDAQ', type: 'index' },
  { symbol: '^VIX', name: 'VIX', type: 'index' },
  { symbol: 'GC=F', name: 'Gold', type: 'commodity' },
  { symbol: 'CL=F', name: 'Crude Oil', type: 'commodity' },
  { symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
  { symbol: 'EURUSD=X', name: 'EUR/USD', type: 'forex' },
  { symbol: 'DX-Y.NYB', name: 'USD Index', type: 'forex' }
];

export async function getMarketOverview() {
  return cached('market_overview', 90_000, async () => {
    const symbols = MARKET_META.map(m => m.symbol);

    // Try bulk v7 first
    const bulk = await quoteBulk(symbols);
    if (bulk && bulk.length > 0) {
      return bulk.map(q => {
        const meta = MARKET_META.find(m => m.symbol === q.symbol) || {};
        return { ...fromV7Quote(q), name: meta.name || q.shortName, type: meta.type };
      });
    }

    // Fallback: chart API per symbol
    const tasks = MARKET_META.map(m => () =>
      chartMeta(m.symbol)
        .then(r => r ? fromChartMeta(r.meta, m.name, m.type) : null)
        .catch(() => null)
    );
    return (await pLimit(tasks, 4)).filter(Boolean);
  });
}

export async function getQuote(symbol) {
  return cached(`quote_${symbol}`, 60_000, async () => {
    if (isInternationalTicker(symbol)) {
      const disk = quoteFromDisk(symbol, { maxAgeMs: DISK_QUOTE_FRESH_MS });
      if (disk) return disk;
      const intl = await quoteViaChart(symbol);
      if (intl) return intl;
    }

    const bulk = await quoteBulk([symbol]);
    if (bulk?.[0]) return fromV7Quote(bulk[0]);

    return quoteViaChart(symbol);
  });
}

export async function getMultipleQuotes(symbols) {
  return cached(`multi_${symbols.join(',')}`, 60_000, async () => {
    const intl = symbols.filter(isInternationalTicker);
    const us = symbols.filter(s => !isInternationalTicker(s));

    const [intlQuotes, usQuotes] = await Promise.all([
      intl.length ? fetchIntlQuotes(intl) : Promise.resolve([]),
      us.length ? fetchUsQuotes(us) : Promise.resolve([])
    ]);

    // Preserve caller's symbol order
    const bySym = new Map([...intlQuotes, ...usQuotes].map(q => [q.symbol, q]));
    return symbols.map(s => bySym.get(s)).filter(Boolean);
  });
}

// Fetch daily OHLCV via the public chart API (works for US + EU ETFs like WEBN.DE).
export async function getHistorical(symbol, days = 100) {
  const candles = await cached(`hist_${symbol}`, 20 * 60_000, () => fetchChartDaily(symbol));
  if (!candles) return null;
  return candles.slice(-days);
}

export async function searchSymbols(query) {
  return cached(`search_${query}`, 300_000, async () => {
    const params = { q: query, quotesCount: 15, newsCount: 0 };
    const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://finance.yahoo.com' };

    for (const base of [BASE2, BASE1]) {
      try {
        const res = await http.get(`${base}/v1/finance/search`, { params, headers });
        return (res.data?.finance?.result?.[0]?.quotes || [])
          .filter(r => ['EQUITY', 'ETF'].includes(r.quoteType))
          .slice(0, 15)
          .map(r => ({
            symbol: r.symbol,
            name: r.longname || r.shortname,
            exchange: r.exchDisp || r.exchange || '',
            type: r.quoteType,
            ticker: r.symbol.includes('.') ? r.symbol.split('.')[0] : r.symbol
          }));
      } catch (e) {
        noteYahooError(e);
      }
    }
    return [];
  });
}
