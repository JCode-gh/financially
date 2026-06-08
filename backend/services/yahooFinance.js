import axios from 'axios';

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

async function pLimit(tasks, limit = 4) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const res = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...res.map(r => r.status === 'fulfilled' ? r.value : null));
    if (i + limit < tasks.length) await new Promise(r => setTimeout(r, 300));
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

// Fallback: v8 chart for single symbol (no auth required)
async function chartMeta(symbol) {
  const res = await yget(`${BASE1}/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    params: { range: '5d', interval: '1d', includePrePost: false },
    headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://finance.yahoo.com' }
  });
  return res.data?.chart?.result?.[0] ?? null;
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
    const bulk = await quoteBulk([symbol]);
    if (bulk?.[0]) return fromV7Quote(bulk[0]);

    const chart = await chartMeta(symbol).catch(() => null);
    return chart ? fromChartMeta(chart.meta, null, null) : null;
  });
}

export async function getMultipleQuotes(symbols) {
  return cached(`multi_${symbols.slice(0, 5).join(',')}`, 60_000, async () => {
    const bulk = await quoteBulk(symbols);
    if (bulk && bulk.length > 0) return bulk.map(fromV7Quote);

    const tasks = symbols.map(sym => () => getQuote(sym));
    return (await pLimit(tasks, 4)).filter(Boolean);
  });
}

// Always fetches a full 400-day window. Cache key has no days component so
// switching 3M→1Y slices the same cached dataset rather than fetching new data.
// TTL is 20 minutes — normal production use never hits Yahoo's rate limits.
export async function getHistorical(symbol, days = 100) {
  const MAX_DAYS = 400;
  const candles = await cached(`hist_${symbol}`, 20 * 60_000, async () => {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - Math.ceil(MAX_DAYS * 1.6) * 86400;
    const params = { period1, period2, interval: '1d', includePrePost: false, events: 'div,splits' };
    const headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': 'https://finance.yahoo.com' };

    // Try query1, then query2 — they can have independent rate limits
    for (const base of [BASE1, BASE2]) {
      try {
        const res = await yget(`${base}/v8/finance/chart/${encodeURIComponent(symbol)}`, { params, headers });
        const result = res.data?.chart?.result?.[0];
        if (!result) continue;
        const { timestamp, indicators } = result;
        const q = indicators.quote[0];
        const parsed = timestamp
          .map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            open: q.open[i] != null ? parseFloat(q.open[i].toFixed(4)) : null,
            high: q.high[i] != null ? parseFloat(q.high[i].toFixed(4)) : null,
            low: q.low[i] != null ? parseFloat(q.low[i].toFixed(4)) : null,
            close: q.close[i] != null ? parseFloat(q.close[i].toFixed(4)) : null,
            volume: q.volume[i] || 0
          }))
          .filter(c => c.close && c.open && c.high && c.low);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        // Rate-limited (429) or in global backoff: try the next server, else re-throw
        if (e.response?.status !== 429 && e.code !== 'YAHOO_BACKOFF') throw e;
      }
    }
    return null; // Both servers rate-limited
  });
  if (!candles) return null;
  return candles.slice(-days);
}

export async function searchSymbols(query) {
  return cached(`search_${query}`, 300_000, async () => {
    try {
      await ensureSession();
      const res = await yget(`${BASE2}/v1/finance/search`, {
        params: { q: query, quotesCount: 8, newsCount: 0 },
        headers: { 'User-Agent': UA, 'Cookie': session.cookie || '', 'Accept': '*/*' }
      });
      return (res.data?.finance?.result?.[0]?.quotes || [])
        .filter(r => ['EQUITY', 'ETF', 'INDEX'].includes(r.quoteType))
        .map(r => ({ symbol: r.symbol, name: r.longname || r.shortname, exchange: r.exchange, type: r.quoteType }));
    } catch { return []; }
  });
}
