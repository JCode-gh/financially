import {
  getMarketOverview as getYahooMarket,
  getQuote as getYahooQuote,
  getMultipleQuotes,
  getQuotableSymbols,
  searchSymbols as searchYahoo
} from '../services/yahooFinance.js';
import {
  getFinnhubQuote,
  getMarketOverview as getFinnhubMarket,
  searchSymbols as searchFinnhub
} from '../services/finnhub.js';
import { getQuote as getAvQuote } from '../services/alphaVantage.js';
import { getHistoricalSeries, quoteFromDisk } from '../services/historyProvider.js';
import { getIntraday } from '../services/twelveData.js';
import { enrichSearchResult, pickBestSearchMatch, rankSearchResult } from '../services/symbolFormat.js';
import { createTtlCache, pLimit } from '../lib/cache.js';
import { AppError } from '../lib/errors.js';

const INTRADAY = new Set(['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h']);
const { cached } = createTtlCache();

function isUsPlain(symbol) {
  return !symbol.includes('.');
}

async function quoteFromHistory(symbol) {
  const fromDisk = quoteFromDisk(symbol);
  if (fromDisk) return fromDisk;
  const hist = await getHistoricalSeries(symbol, 5, 7 * 24 * 3600_000).catch(() => null);
  if (!hist?.length) return null;
  const last = hist[hist.length - 1];
  const prev = hist.length > 1 ? hist[hist.length - 2] : last;
  const change = last.close - prev.close;
  return {
    symbol,
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
}

/** Live overlay for bulk jobs — Yahoo/disk only, no paid fallbacks. */
export async function getQuickQuote(symbol) {
  const data = await getYahooQuote(symbol).catch(() => null);
  return data || quoteFromDisk(symbol);
}

export async function getQuote(symbol) {
  let data = await getYahooQuote(symbol).catch(() => null);
  if (!data && isUsPlain(symbol)) data = await getFinnhubQuote(symbol).catch(() => null);
  if (!data) data = await getAvQuote(symbol).catch(() => null);
  if (!data) data = await quoteFromHistory(symbol);
  return data;
}

export async function getQuotes(symbols) {
  if (!symbols.length) return [];
  let data = await getMultipleQuotes(symbols).catch(() => []);
  const have = new Set((data || []).map(q => q.symbol));
  const missing = symbols.filter(s => !have.has(s));
  if (missing.length) {
    const extras = await pLimit(
      missing.map(sym => async () => (await getQuote(sym).catch(() => null)) || quoteFromHistory(sym)),
      4,
      80
    );
    data = [...(data || []), ...extras.filter(Boolean)];
  }
  const bySym = new Map((data || []).map(q => [q.symbol, q]));
  return symbols.map(s => bySym.get(s)).filter(Boolean);
}

export async function getMarket() {
  let data = await getYahooMarket().catch(() => null);
  if (!data?.length) data = await getFinnhubMarket().catch(() => null);
  return data?.length ? data : [];
}

export async function getHistorical(symbol, { days = 100, interval = '1day', freshMs } = {}) {
  if (INTRADAY.has(interval)) {
    const bars = Math.min(2000, days);
    return getIntraday(symbol, interval, bars);
  }
  const window = Math.min(5000, days);
  const maxAge = freshMs ?? 24 * 3600_000;
  let data = await getHistoricalSeries(symbol, window, maxAge);
  if (!data?.length) {
    const { getHistorical: getStooqHist } = await import('../services/stooq.js');
    data = await getStooqHist(symbol, window).catch(() => null);
  }
  return data || [];
}

export async function getHistoricalBatch(symbols, days = 63) {
  const unique = [...new Set(symbols)].slice(0, 24);
  const rows = await pLimit(
    unique.map(sym => async () => {
      const candles = await getHistorical(sym, { days, interval: '1day' }).catch(() => []);
      return [sym, candles || []];
    }),
    3,
    120
  );
  return Object.fromEntries(rows.filter(Boolean));
}

async function mergeSearch(q) {
  return cached(`search_${q.toLowerCase()}`, 120_000, async () => {
    const [yahoo, finnhub] = await Promise.all([
      searchYahoo(q).catch(() => []),
      searchFinnhub(q).catch(() => [])
    ]);
    const seen = new Set();
    const data = [];
    for (const r of [...yahoo, ...finnhub]) {
      if (!r?.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      data.push(enrichSearchResult(r));
    }
    data.sort((a, b) => rankSearchResult(q, b) - rankSearchResult(q, a));
    return data;
  });
}

export async function search(q, limit = 15) {
  if (!q?.trim()) return [];
  return (await mergeSearch(q.trim())).slice(0, limit);
}

export async function resolveSymbol(q) {
  if (!q?.trim()) return { symbol: null, match: null, alternatives: [] };
  const input = q.trim().toUpperCase();
  const merged = await mergeSearch(q);
  const candidates = merged.slice(0, 25);
  const quotable = await getQuotableSymbols(candidates.map(r => r.symbol));
  const results = candidates.filter(r => quotable.has(r.symbol)).slice(0, 20);
  const symbol = pickBestSearchMatch(input, results) || results.find(r => r.symbol === input)?.symbol || null;
  const match = symbol ? results.find(r => r.symbol === symbol) || null : null;
  return { symbol, match, alternatives: results.slice(0, 8) };
}

export function requireHistory(candles, ticker) {
  if (!candles || candles.length < 30) {
    throw new AppError(`Insufficient historical data for ${ticker} to run model`, 503, 'NO_HISTORY');
  }
  return candles;
}
