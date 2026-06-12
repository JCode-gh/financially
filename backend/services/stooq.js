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
