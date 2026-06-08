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

export async function getStockNews(ticker) {
  const today = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  return cached(`stock_news_${ticker}`, 300_000, async () => {
    const data = await get('/company-news', { symbol: ticker, from, to: today });
    if (!data) return [];
    return data.slice(0, 20).map(n => ({
      id: n.id,
      headline: n.headline,
      summary: n.summary,
      source: n.source,
      url: n.url,
      image: n.image,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
      related: ticker
    }));
  });
}

export async function getBasicFinancials(ticker) {
  return cached(`financials_${ticker}`, 3600_000, async () => {
    const data = await get('/stock/metric', { symbol: ticker, metric: 'all' });
    if (!data || !data.metric) return null;
    const m = data.metric;
    return {
      peRatioTTM: m.peNormalizedAnnual,
      epsGrowth: m.epsGrowth5Y,
      revenueGrowth: m.revenueGrowth5Y,
      roeTTM: m.roeTTM,
      debtToEquity: m.totalDebt_totalEquityAnnual,
      currentRatio: m.currentRatioAnnual,
      dividendYield: m.dividendYieldIndicatedAnnual,
      priceToBook: m.pbAnnual,
      week52High: m['52WeekHigh'],
      week52Low: m['52WeekLow']
    };
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

// Symbol search via Finnhub
export async function searchSymbols(query) {
  if (!query?.trim()) return [];
  return cached(`fh_search_${query}`, 300_000, async () => {
    const data = await get('/search', { q: query });
    if (!data?.result) return [];
    return data.result
      .filter(r => r.type === 'Common Stock' && !r.symbol.includes('.'))
      .slice(0, 10)
      .map(r => ({
        symbol: r.symbol,
        name: r.description,
        exchange: r.displaySymbol,
        type: 'EQUITY'
      }));
  });
}
