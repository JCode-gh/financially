// Stooq — completely free, keyless daily OHLCV history (CSV download).
// Decades of data, no rate-limit drama. Used as a deep-history fallback when
// Twelve Data / Yahoo / Alpha Vantage are all unavailable.
// US symbols use the ".us" suffix; share classes use a dash (brk-b.us).

import axios from 'axios';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => {
    if (data) cache.set(key, { data, ts: Date.now() });
    return data;
  });
}

function toStooqSymbol(symbol) {
  const s = symbol.toLowerCase();
  // Indices and non-equities aren't reliably mapped
  if (s.startsWith('^') || s.includes('=') || s.includes(':')) return null;
  // International tickers already carry an exchange suffix (abi.br, inga.as, sap.de)
  if (s.includes('.')) return s;
  // US equities/ETFs
  return `${s}.us`;
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 3 || !lines[0].toLowerCase().startsWith('date')) return null;
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, open, high, low, close, volume] = lines[i].split(',');
    const o = parseFloat(open), h = parseFloat(high), l = parseFloat(low), c = parseFloat(close);
    if (!date || !o || !h || !l || !c) continue;
    candles.push({
      date,
      open: parseFloat(o.toFixed(4)),
      high: parseFloat(h.toFixed(4)),
      low: parseFloat(l.toFixed(4)),
      close: parseFloat(c.toFixed(4)),
      volume: parseInt(volume, 10) || 0
    });
  }
  return candles.length ? candles.sort((a, b) => a.date.localeCompare(b.date)) : null;
}

export async function getHistorical(symbol, days = 100) {
  const stooqSym = toStooqSymbol(symbol);
  if (!stooqSym) return null;

  const series = await cached(`stooq_${symbol}`, 30 * 60_000, async () => {
    try {
      const res = await axios.get('https://stooq.com/q/d/l/', {
        params: { s: stooqSym, i: 'd' },
        timeout: 12000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/csv,text/plain,*/*'
        }
      });
      if (typeof res.data !== 'string' || res.data.includes('<html')) return null;
      return parseCsv(res.data);
    } catch {
      return null;
    }
  });

  if (!series?.length) return null;
  return series.slice(-days);
}

function quoteFromCandles(symbol, candles) {
  if (!candles?.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const change = last.close - prev.close;
  return {
    symbol: symbol.toUpperCase(),
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

export async function getQuote(symbol) {
  const candles = await getHistorical(symbol, 5);
  return quoteFromCandles(symbol, candles);
}

const MARKET_ITEMS = [
  { ticker: 'SPY', symbol: '^GSPC', name: 'S&P 500', type: 'index' },
  { ticker: 'DIA', symbol: '^DJI', name: 'Dow Jones', type: 'index' },
  { ticker: 'QQQ', symbol: '^IXIC', name: 'NASDAQ', type: 'index' },
  { ticker: 'IWM', symbol: '^RUT', name: 'Russell 2000', type: 'index' },
  { ticker: 'GLD', symbol: 'GC=F', name: 'Gold', type: 'commodity' },
  { ticker: 'USO', symbol: 'CL=F', name: 'Crude Oil', type: 'commodity' },
  { ticker: 'BTC.V', symbol: 'BTC-USD', name: 'Bitcoin', type: 'crypto' },
  { ticker: 'ETH.V', symbol: 'ETH-USD', name: 'Ethereum', type: 'crypto' }
];

export async function getMarketOverview() {
  const rows = await Promise.all(
    MARKET_ITEMS.map(async item => {
      const q = await getQuote(item.ticker).catch(() => null);
      if (!q?.price) return null;
      return { ...q, symbol: item.symbol, name: item.name, type: item.type };
    })
  );
  return rows.filter(Boolean);
}
