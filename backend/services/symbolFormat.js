// Human-readable market labels for exchange suffixes (Yahoo/Finnhub format: TICKER.BR)
const EXCHANGE_LABELS = {
  BR: 'Brussels',
  AS: 'Amsterdam',
  PA: 'Paris',
  DE: 'Frankfurt',
  L: 'London',
  VI: 'Vienna',
  ST: 'Stockholm',
  HE: 'Helsinki',
  CO: 'Copenhagen',
  OL: 'Oslo',
  SW: 'Switzerland',
  MI: 'Milan',
  MU: 'Munich',
  DU: 'Dusseldorf',
  F: 'Frankfurt',
  HM: 'Hamburg',
  MC: 'Madrid',
  LS: 'Lisbon',
  WA: 'Warsaw',
  PR: 'Prague',
  AX: 'Australia',
  TO: 'Toronto',
  V: 'TSX Venture',
  HK: 'Hong Kong',
  SS: 'Shanghai',
  SZ: 'Shenzhen',
  T: 'Tokyo',
  US: 'United States'
};

export function marketFromSymbol(symbol) {
  if (!symbol?.includes('.')) return 'United States';
  const suffix = symbol.split('.').pop()?.toUpperCase();
  return EXCHANGE_LABELS[suffix] || suffix;
}

export function enrichSearchResult(result) {
  if (!result?.symbol) return result;
  const dot = result.symbol.lastIndexOf('.');
  const ticker = dot > 0 ? result.symbol.slice(0, dot) : result.symbol;
  const market = marketFromSymbol(result.symbol);
  // Finnhub often puts the full symbol in `exchange` — replace with a readable market name
  return {
    ...result,
    ticker,
    market,
    exchange: market
  };
}

// Prefer these when the same ticker lists on multiple EU exchanges
const EXCHANGE_PREF = ['.DE', '.BR', '.AS', '.PA', '.MI', '.L', '.VI', '.MU', '.F'];

function pickPreferredSymbol(candidates) {
  const symbols = candidates.map(c => (typeof c === 'string' ? c : c.symbol));
  for (const suf of EXCHANGE_PREF) {
    const hit = symbols.find(s => s.endsWith(suf));
    if (hit) return hit;
  }
  return symbols[0];
}

function isFundType(type) {
  return type === 'ETF' || type === 'ETP';
}

/**
 * Turn a bare user input (e.g. "KBCA" or "WEBN") into the full symbol
 * (e.g. "KBCA.BR" or "WEBN.DE") when search finds a clear match.
 */
export function pickBestSearchMatch(query, results) {
  if (!results?.length) return null;
  const q = query.trim().toUpperCase();
  if (!q) return null;

  const relevant = results.filter(r => {
    const base = r.ticker || (r.symbol?.includes('.') ? r.symbol.split('.')[0] : r.symbol);
    return base === q || r.symbol === q || r.symbol?.startsWith(`${q}.`);
  });
  const pool = relevant.length ? relevant : results;

  const exact = pool.find(r => r.symbol === q);
  if (exact) return exact.symbol;

  const suffixed = pool.filter(r => r.symbol?.startsWith(`${q}.`));
  if (suffixed.length === 1) return suffixed[0].symbol;

  const funds = suffixed.filter(r => isFundType(r.type));
  if (funds.length) return pickPreferredSymbol(funds);

  if (suffixed.length) return pickPreferredSymbol(suffixed);

  if (pool.length === 1) return pool[0].symbol;

  return null;
}

export function rankSearchResult(query, result) {
  const q = query.trim().toUpperCase();
  let score = 0;
  const base = result.ticker || (result.symbol?.includes('.') ? result.symbol.split('.')[0] : result.symbol);
  if (result.symbol === q) score += 100;
  if (base === q) score += 60;
  if (result.symbol?.startsWith(`${q}.`)) score += 40;
  if (isFundType(result.type)) score += 25;
  if (result.symbol?.endsWith('.DE')) score += 10;
  if (result.symbol?.endsWith('.BR')) score += 10;
  return score;
}
