import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://finnhub.io/api/v1';
const KEY = process.env.FINNHUB_API_KEY || '';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

async function get(path, params = {}) {
  if (!KEY) return null;
  try {
    const res = await axios.get(`${BASE}${path}`, {
      params: { ...params, token: KEY },
      timeout: 8000
    });
    return res.data;
  } catch {
    return null;
  }
}

export async function getMarketNews(category = 'general') {
  return cached(`market_news_${category}`, 600_000, async () => {
    const data = await get('/news', { category });
    if (!data) return [];
    return data.slice(0, 40).map(n => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary,
      source: n.source,
      url: n.url,
      image: n.image,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
      related: n.related || ''
    }));
  });
}

function mapCompanyNews(data, ticker) {
  if (!Array.isArray(data)) return [];
  return data.map(n => ({
    id: n.id,
    headline: n.headline,
    summary: n.summary,
    source: n.source,
    url: n.url,
    image: n.image,
    publishedAt: n.datetime ? new Date(n.datetime * 1000).toISOString() : null,
    related: n.related || '',
    trustedTicker: ticker
  })).filter(n => n.headline && n.publishedAt);
}

export async function getStockNews(ticker) {
  const today = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
  return cached(`stock_news_${ticker}`, 300_000, async () => {
    const data = await get('/company-news', { symbol: ticker, from, to: today });
    return mapCompanyNews(data, ticker).slice(0, 80);
  });
}

export async function getStockNewsHistory(ticker, days = 400) {
  const span = Math.min(Math.max(Number(days) || 400, 30), 400);
  const key = `stock_news_hist_${String(ticker || '').toUpperCase()}_${span}`;
  return cached(key, 300_000, async () => {
    const now = Date.now();
    const windows = [];
    for (let offset = 0; offset < span; offset += 90) {
      const to = new Date(now - offset * 86400000).toISOString().split('T')[0];
      const from = new Date(now - Math.min(span, offset + 90) * 86400000).toISOString().split('T')[0];
      if (from >= to) continue;
      windows.push({ from, to });
    }
    const chunks = [];
    for (const w of windows) {
      chunks.push(await get('/company-news', { symbol: ticker, from: w.from, to: w.to }));
    }
    const seen = new Set();
    const out = [];
    for (const data of chunks) {
      for (const n of mapCompanyNews(data, ticker)) {
        const id = n.url || String(n.id || '') || n.headline;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(n);
      }
    }
    return out.slice(0, 1000);
  });
}

export async function getCompanyProfile(ticker) {
  return cached(`profile_${ticker}`, 24 * 3600_000, async () => {
    const data = await get('/stock/profile2', { symbol: ticker });
    if (!data?.name && !data?.country && !data?.finnhubIndustry) return null;
    return {
      name: data.name || '',
      country: data.country || '',
      industry: data.finnhubIndustry || '',
      exchange: data.exchange || '',
      marketCap: data.marketCapitalization || null,
      weburl: data.weburl || ''
    };
  });
}

function firstNum(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

export async function getBasicFinancials(ticker) {
  return cached(`financials_${ticker}`, 3600_000, async () => {
    const data = await get('/stock/metric', { symbol: ticker, metric: 'all' });
    if (!data || !data.metric) return null;
    const m = data.metric;
    const pe = firstNum(
      m.peTTM,
      m.peNormalizedAnnual,
      m.peAnnual,
      m.peBasicExclExtraTTM,
      m.peExclExtraTTM,
      m.peExclExtraAnnual
    );
    return {
      peRatioTTM: pe,
      forwardPE: firstNum(m.forwardPE, m.peNormalizedAnnual),
      epsGrowth: firstNum(m.epsGrowthTTMYoy, m.epsGrowth5Y, m.epsGrowth3Y),
      revenueGrowth: firstNum(m.revenueGrowthTTMYoy, m.revenueGrowth5Y, m.revenueGrowth3Y),
      roeTTM: firstNum(m.roeTTM, m.roeRfy),
      debtToEquity: firstNum(m.totalDebt_totalEquityAnnual, m.totalDebtToEquity),
      currentRatio: firstNum(m.currentRatioTTM, m.currentRatioAnnual),
      dividendYield: firstNum(m.dividendYieldIndicatedAnnual, m.dividendYieldTTM),
      priceToBook: firstNum(m.pbAnnual, m.pbQuarterly, m.pb),
      week52High: m['52WeekHigh'],
      week52Low: m['52WeekLow']
    };
  });
}

export async function getInsiderTransactions(ticker) {
  return cached(`insider_${ticker}`, 3600_000, async () => {
    const from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const data = await get('/stock/insider-transactions', { symbol: ticker, from });
    const rows = data?.data;
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.slice(0, 40).map(r => ({
      name: r.name || '',
      shares: Number(r.change) || 0,
      price: r.transactionPrice != null ? Number(r.transactionPrice) : null,
      date: r.transactionDate || r.filingDate || '',
      code: r.transactionCode || ''
    }));
  });
}

export async function getFilings(ticker) {
  return cached(`filings_${ticker}`, 6 * 3600_000, async () => {
    const data = await get('/stock/filings', { symbol: ticker });
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return null;
    return rows.slice(0, 20).map(r => ({
      type: r.form || r.type || '',
      date: r.filedDate || r.acceptedDate || '',
      title: r.form || r.reportUrl || '',
      url: r.reportUrl || r.filingUrl || ''
    })).filter(f => f.type || f.url);
  });
}

export async function getSentimentData(ticker) {
  return cached(`sentiment_${ticker}`, 3600_000, async () => {
    const data = await get('/news-sentiment', { symbol: ticker });
    if (!data) return null;
    return {
      bullishPercent: data.sentiment?.bullishPercent,
      bearishPercent: data.sentiment?.bearishPercent,
      score: data.sentiment?.score,
      articlesInLastWeek: data.articlesInLastWeek,
      buzz: data.buzz?.buzz,
      weeklyAverage: data.buzz?.weeklyAverage
    };
  });
}

// Historical OHLCV candles via Finnhub (resolution D = daily)
export async function getCandles(symbol, days = 400) {
  return cached(`candles_${symbol}_${days}`, 300_000, async () => {
    const to = Math.floor(Date.now() / 1000);
    // Fetch 1.6× requested trading days to account for weekends/holidays
    const from = to - Math.ceil(days * 1.6) * 86400;
    const data = await get('/stock/candle', { symbol, resolution: 'D', from, to });
    if (!data || data.s !== 'ok' || !data.t?.length) return null;
    return data.t.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: parseFloat((data.o[i] || 0).toFixed(4)),
      high: parseFloat((data.h[i] || 0).toFixed(4)),
      low: parseFloat((data.l[i] || 0).toFixed(4)),
      close: parseFloat((data.c[i] || 0).toFixed(4)),
      volume: data.v[i] || 0
    })).filter(c => c.close && c.open);
  });
}

// Market overview via free-tier Finnhub symbols (ETF/index proxies + crypto)
// Uses ETFs as proxies for indices since Finnhub free tier doesn't support direct index access
const MARKET_ITEMS = [
  { finnhub: 'SPY', symbol: '^GSPC', name: 'S&P 500', type: 'index' },
  { finnhub: 'DIA', symbol: '^DJI', name: 'Dow Jones', type: 'index' },
  { finnhub: 'QQQ', symbol: '^IXIC', name: 'NASDAQ', type: 'index' },
  { finnhub: 'IWM', symbol: '^RUT', name: 'Russell 2000', type: 'index' },
  { finnhub: 'BINANCE:BTCUSDT', symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { finnhub: 'BINANCE:ETHUSDT', symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' },
  { finnhub: 'BINANCE:SOLUSDT', symbol: 'SOL-USD', name: 'Solana', type: 'crypto' },
  { finnhub: 'BINANCE:BNBUSDT', symbol: 'BNB-USD', name: 'BNB', type: 'crypto' }
];

export async function getMarketOverview() {
  return cached('fh_market_overview', 90_000, async () => {
    const results = await Promise.allSettled(
      MARKET_ITEMS.map(async item => {
        const q = await getFinnhubQuote(item.finnhub);
        if (!q?.price) return null;
        return { ...q, symbol: item.symbol, name: item.name, type: item.type };
      })
    );
    return results
      .map(r => (r.status === 'fulfilled' ? r.value : null))
      .filter(Boolean);
  });
}

// Real-time quote via Finnhub
export async function getFinnhubQuote(symbol) {
  return cached(`fh_quote_${symbol}`, 60_000, async () => {
    const data = await get('/quote', { symbol });
    if (!data || !data.c) return null;
    return {
      symbol,
      price: data.c,
      change: data.d,
      changePct: data.dp,
      open: data.o,
      previousClose: data.pc,
      dayHigh: data.h,
      dayLow: data.l
    };
  });
}

// Symbol search via Finnhub — stocks, ETFs, ETPs, and ADRs (e.g. WEBN.DE)
function isSearchableResult(r) {
  if (['Common Stock', 'ETF', 'ETP', 'ADR'].includes(r.type)) return true;
  // Some listings have empty type but a valid exchange suffix
  return !r.type && /^[A-Z0-9-]+\.[A-Z]{1,4}$/.test(r.symbol);
}

function normalizeSearchType(type) {
  if (type === 'ETP') return 'ETF';
  return type || 'EQUITY';
}

export async function searchSymbols(query) {
  if (!query?.trim()) return [];
  return cached(`fh_search_${query}`, 300_000, async () => {
    const data = await get('/search', { q: query });
    if (!data?.result) return [];
    return data.result
      .filter(isSearchableResult)
      .slice(0, 20)
      .map(r => ({
        symbol: r.symbol,
        name: r.description,
        exchange: r.displaySymbol || r.symbol.split('.').pop() || '',
        type: normalizeSearchType(r.type),
        ticker: r.symbol.includes('.') ? r.symbol.split('.')[0] : r.symbol
      }));
  });
}
