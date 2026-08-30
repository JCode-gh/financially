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

export function isInternationalTicker(symbol) {
  return /^[A-Z0-9-]+\.[A-Z]{1,4}$/.test(String(symbol || '').toUpperCase()) && !String(symbol).startsWith('^');
}

export function newsLocalesForSymbol(symbol) {
  const suffix = String(symbol || '').split('.').pop()?.toUpperCase();
  const byEx = {
    BR: [
      { hl: 'nl', gl: 'BE', ceid: 'BE:nl' },
      { hl: 'fr', gl: 'BE', ceid: 'BE:fr' },
      { hl: 'en', gl: 'BE', ceid: 'BE:en' }
    ],
    AS: [
      { hl: 'nl', gl: 'NL', ceid: 'NL:nl' },
      { hl: 'en', gl: 'NL', ceid: 'NL:en' }
    ],
    PA: [
      { hl: 'fr', gl: 'FR', ceid: 'FR:fr' },
      { hl: 'en', gl: 'FR', ceid: 'FR:en' }
    ],
    DE: [
      { hl: 'de', gl: 'DE', ceid: 'DE:de' },
      { hl: 'en', gl: 'DE', ceid: 'DE:en' }
    ],
    F: [
      { hl: 'de', gl: 'DE', ceid: 'DE:de' },
      { hl: 'en', gl: 'DE', ceid: 'DE:en' }
    ],
    MU: [
      { hl: 'de', gl: 'DE', ceid: 'DE:de' },
      { hl: 'en', gl: 'DE', ceid: 'DE:en' }
    ],
    L: [{ hl: 'en', gl: 'GB', ceid: 'GB:en' }],
    MI: [
      { hl: 'it', gl: 'IT', ceid: 'IT:it' },
      { hl: 'en', gl: 'IT', ceid: 'IT:en' }
    ],
    MC: [
      { hl: 'es', gl: 'ES', ceid: 'ES:es' },
      { hl: 'en', gl: 'ES', ceid: 'ES:en' }
    ],
    SW: [
      { hl: 'de', gl: 'CH', ceid: 'CH:de' },
      { hl: 'fr', gl: 'CH', ceid: 'CH:fr' },
      { hl: 'en', gl: 'CH', ceid: 'CH:en' }
    ],
    ST: [
      { hl: 'sv', gl: 'SE', ceid: 'SE:sv' },
      { hl: 'en', gl: 'SE', ceid: 'SE:en' }
    ],
    HE: [
      { hl: 'fi', gl: 'FI', ceid: 'FI:fi' },
      { hl: 'en', gl: 'FI', ceid: 'FI:en' }
    ],
    CO: [
      { hl: 'da', gl: 'DK', ceid: 'DK:da' },
      { hl: 'en', gl: 'DK', ceid: 'DK:en' }
    ],
    OL: [
      { hl: 'no', gl: 'NO', ceid: 'NO:nb' },
      { hl: 'en', gl: 'NO', ceid: 'NO:en' }
    ],
    VI: [
      { hl: 'de', gl: 'AT', ceid: 'AT:de' },
      { hl: 'en', gl: 'AT', ceid: 'AT:en' }
    ],
    LS: [
      { hl: 'pt', gl: 'PT', ceid: 'PT:pt' },
      { hl: 'en', gl: 'PT', ceid: 'PT:en' }
    ]
  };
  if (byEx[suffix]) return byEx[suffix];
  if (isInternationalTicker(symbol)) {
    return [
      { hl: 'en', gl: 'GB', ceid: 'GB:en' },
      { hl: 'en', gl: 'US', ceid: 'US:en' }
    ];
  }
  return [{ hl: 'en', gl: 'US', ceid: 'US:en' }];
}

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
