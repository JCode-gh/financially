export function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ldquo;|&rdquo;|&#x201[cd];/gi, '"')
    .replace(/&lsquo;|&rsquo;|&#x201[89];/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function dedupeArticles(articles) {
  const seen = new Set();
  return (articles || [])
    .map(a => ({
      ...a,
      headline: decodeEntities(a.headline),
      summary: decodeEntities(a.summary)
    }))
    .filter(a => {
      const key = (a.headline || '').toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

const STOCK_SIGNAL = /\b(stock|stocks|share|shares|equity|equities|earnings|revenue|EPS|quarterly|dividend|dividends|IPO|buyback|merger|acquisition|valuation|portfolio|hedge fund|futures|options|market cap|index fund|ETF|mutual fund|short sell|analyst|analysts|Wall Street|NYSE|Nasdaq|S&P 500|Dow Jones|FTSE|rally|selloff|sell-off|correction|bull market|bear market|Federal Reserve|interest rate|yield curve|bond yield|treasury|central bank|forecast|guidance|outlook|price target|upgrade|downgrade|overweight|underweight|buy rating|hold rating|sell rating|aandeel|aandelen|beurs|koers|koersdoel|kwartaalcijfers|omzet|winst|belegger|beleggers|Euronext|Bel 20|AEX|CAC 40|DAX|action|actions|bourse|bénéfice|dividende|aktie|börse|gewinn|umsatz)\b/i;

const PERSONAL_NOISE = /\b(my (mother|father|mom|dad|wife|husband|parents?)|dementia|inheritance|will and testament|social security|credit card debt|student loan|how (do|can) i|what should i do|personal finance|retirement advice|stock certificate|labor day sales|black friday|cyber monday|gift guide|early deals from)\b/i;

const MARKET_WIDE = /\b(S&P 500|S&P500|Dow Jones|Nasdaq|Federal Reserve|Fed |Treasury|yield curve|jobs report|CPI|inflation|FOMC|rate cut|rate hike|Wall Street|equity futures|premarket|after.?hours|Euronext|Bel 20|AEX|CAC 40|DAX|FTSE 100|ECB|European Central Bank)\b/i;

const COMMON_WORDS = new Set([
  'INC', 'CORP', 'LTD', 'PLC', 'NV', 'SA', 'AG', 'SE', 'AB', 'ASA', 'OYJ', 'SPA',
  'GMBH', 'BV', 'THE', 'AND', 'GROUP', 'GROEP', 'GROUPE', 'HOLDINGS', 'HOLDING',
  'COMPANY', 'CO', 'CLASS', 'ORDINARY', 'SHARES', 'STOCK', 'ADR'
]);

const NAME_ALIASES = {
  AAPL: ['IPHONE', 'IPAD', 'MACBOOK', 'AIRPODS'],
  MSFT: ['MICROSOFT', 'AZURE', 'COPILOT'],
  GOOGL: ['GOOGLE', 'YOUTUBE', 'ANDROID'],
  GOOG: ['GOOGLE', 'YOUTUBE', 'ANDROID'],
  AMZN: ['AMAZON', 'AWS'],
  META: ['FACEBOOK', 'INSTAGRAM', 'WHATSAPP'],
  NVDA: ['NVIDIA', 'GEFORCE'],
  TSLA: ['TESLA', 'CYBERTRUCK'],
  'KBC.BR': ['KBC GROEP', 'KBC GROUP'],
  'ABI.BR': ['AB INBEV', 'ANHEUSER-BUSCH INBEV', 'ANHEUSER BUSCH INBEV', 'ANHEUSER-BUSCH'],
  'UCB.BR': ['UCB SA', 'UCB NV'],
  'ACKB.BR': ['ACKERMANS', 'ACKERMANS & VAN HAAREN', 'ACKERMANS VAN HAAREN'],
  'GBLB.BR': ['GROUPE BRUXELLES LAMBERT', 'GBL'],
  'SOLB.BR': ['SOLVAY'],
  'ARGX.BR': ['ARGENX'],
  'UMI.BR': ['UMICORE'],
  'ELI.BR': ['ELIA'],
  'PROX.BR': ['PROXIMUS'],
  'COLR.BR': ['COLRUYT'],
  'WDP.BR': ['WAREHOUSES DE PAUW'],
  'INGA.AS': ['ING GROEP', 'ING GROUP'],
  'ASML.AS': ['ASML'],
  'PHIA.AS': ['PHILIPS'],
  'AD.AS': ['AHOLD DELHAIZE'],
  'HEIA.AS': ['HEINEKEN'],
  'AIR.PA': ['AIRBUS'],
  'MC.PA': ['LVMH'],
  'TTE.PA': ['TOTALENERGIES']
};

function stripLegalSuffixes(name) {
  return String(name || '')
    .replace(/\b(SA\/NV|NV\/SA|S\.?A\.?|N\.?V\.?)\b/gi, ' ')
    .replace(/,?\s+\b(Inc|Incorporated|Corp|Corporation|Ltd|Limited|PLC|NV|SA|AG|SE|AB|ASA|GmbH|BV|SRL|SAS|SpA)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function companyPhrases(name) {
  const cleaned = stripLegalSuffixes(name);
  if (!cleaned) return [];
  const phrases = new Set([cleaned]);
  if (/group$/i.test(cleaned)) phrases.add(cleaned.replace(/group$/i, 'Groep'));
  if (/groep$/i.test(cleaned)) phrases.add(cleaned.replace(/groep$/i, 'Group'));
  if (/groupe$/i.test(cleaned)) phrases.add(cleaned.replace(/groupe$/i, 'Group'));
  return [...phrases].filter(p => p.length >= 5 || /\s/.test(p));
}

export function companySearchTerms(ticker, name) {
  const terms = new Set(companyPhrases(name));
  const raw = String(ticker || '').toUpperCase();
  for (const alias of (NAME_ALIASES[raw] || [])) terms.add(alias);
  if (raw.includes('.')) terms.add(raw);
  const base = raw.split(/[.-]/)[0];
  if (base && base.length >= 5) terms.add(base);
  return [...terms].filter(Boolean);
}

export function isStockRelated(article) {
  const text = `${article.headline || ''} ${article.summary || ''}`;
  if (PERSONAL_NOISE.test(text)) return false;
  return STOCK_SIGNAL.test(text) || MARKET_WIDE.test(text);
}

export function isPersonalNoise(article) {
  const text = `${article.headline || ''} ${article.summary || ''}`;
  return PERSONAL_NOISE.test(text);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tickerTokens(ticker, name) {
  const tokens = new Set();
  const raw = String(ticker || '').toUpperCase();
  if (raw) {
    tokens.add(raw);
    tokens.add(raw.replace(/[-.]/g, ''));
    const base = raw.split(/[.-]/)[0];
    if (base.length >= 4 || (base.length >= 3 && !raw.includes('.'))) tokens.add(base);
    if (raw.includes('.')) {
      tokens.add(`ENXTBR:${base}`);
      tokens.add(`EBR:${base}`);
      tokens.add(`EPA:${base}`);
      tokens.add(`AMS:${base}`);
      tokens.add(`FRA:${base}`);
    }
  }
  for (const phrase of companyPhrases(name)) tokens.add(phrase.toUpperCase());
  if (name) {
    for (const part of stripLegalSuffixes(name).split(/[\s,./&+-]+/)) {
      const p = part.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if ((p.length >= 4 || (p.length >= 3 && !raw.includes('.'))) && !COMMON_WORDS.has(p)) tokens.add(p);
    }
  }
  for (const alias of (NAME_ALIASES[raw] || [])) tokens.add(String(alias).toUpperCase());
  return [...tokens].filter(Boolean);
}

function textMentions(text, tokens) {
  const u = String(text || '').toUpperCase();
  return tokens.some(tok => new RegExp(`(?:^|[^A-Z0-9])${escapeRe(tok)}(?:[^A-Z0-9]|$)`).test(u));
}

const LOCAL_MARKET = /\b(belgium|belgian|belgi[eë]|belgisch|brussels?|brussel|euronext|enxtbr|enxtam|enxtpa|aandeel|aandelen|amsterdam|paris|frankfurt|biotech|pharma|bel 20|aex|cac|dax)\b/i;

export function articleMentionsTicker(article, ticker, name) {
  if (!article || !ticker) return false;
  const sym = String(ticker).toUpperCase();
  if (article.trustedTicker && String(article.trustedTicker).toUpperCase() === sym) return true;
  const tokens = tickerTokens(ticker, name);
  const blob = `${article.headline || ''} ${article.summary || ''}`;
  if (textMentions(blob, tokens)) return true;
  const base = sym.split(/[.-]/)[0];
  return !!(sym.includes('.') && base.length >= 3 && textMentions(blob, [base]) && LOCAL_MARKET.test(blob));
}

export function relevanceScore(article, tickers = []) {
  const text = `${article.headline || ''} ${article.summary || ''}`;
  if (PERSONAL_NOISE.test(text)) return -10;
  let score = 0;
  if (STOCK_SIGNAL.test(text)) score += 1;
  if (MARKET_WIDE.test(text)) score += 2;
  for (const t of tickers) {
    if (articleMentionsTicker(article, t.symbol, t.name)) score += 5;
  }
  return score;
}

export function filterForTicker(articles, ticker, name) {
  return (articles || []).filter(a => !isPersonalNoise(a) && articleMentionsTicker(a, ticker, name));
}

export function rankForWatchlist(articles, tickers = []) {
  const list = (tickers || []).filter(t => t && t.symbol);
  const tagged = (articles || [])
    .filter(a => !isPersonalNoise(a))
    .map(a => {
      const matched = list.filter(t => articleMentionsTicker(a, t.symbol, t.name));
      return { a, matched, score: relevanceScore(a, list) };
    });

  const pool = list.length
    ? tagged.filter(x => x.matched.length > 0)
    : tagged.filter(x => x.score > 0 && isStockRelated(x.a));

  return pool
    .sort((x, y) => y.matched.length - x.matched.length || y.score - x.score || new Date(y.a.publishedAt) - new Date(x.a.publishedAt))
    .map(({ a, matched }) => ({
      ...a,
      matchedSymbols: matched.map(t => t.symbol)
    }));
}
