import { getCompanyProfile, getBasicFinancials, getInsiderTransactions, getFilings } from './finnhub.js';
import { getYahooDeskFundamentals, getYahooOptionsSnapshot } from './yahooFinance.js';
import { getMarketRegime } from '../models/marketRegime.js';
import { createTtlCache } from '../lib/cache.js';
import { webSearch } from './webSearch.js';

const { cached } = createTtlCache();

const COUNTRY = {
  US: { en: 'United States', nl: 'Verenigde Staten' },
  NL: { en: 'Netherlands', nl: 'Nederland' },
  BE: { en: 'Belgium', nl: 'België' },
  DE: { en: 'Germany', nl: 'Duitsland' },
  FR: { en: 'France', nl: 'Frankrijk' },
  GB: { en: 'United Kingdom', nl: 'Verenigd Koninkrijk' },
  UK: { en: 'United Kingdom', nl: 'Verenigd Koninkrijk' },
  IE: { en: 'Ireland', nl: 'Ierland' },
  TW: { en: 'Taiwan', nl: 'Taiwan' },
  CN: { en: 'China', nl: 'China' },
  JP: { en: 'Japan', nl: 'Japan' },
  KR: { en: 'South Korea', nl: 'Zuid-Korea' },
  IN: { en: 'India', nl: 'India' },
  BR: { en: 'Brazil', nl: 'Brazilië' },
  CA: { en: 'Canada', nl: 'Canada' },
  AU: { en: 'Australia', nl: 'Australië' },
  CH: { en: 'Switzerland', nl: 'Zwitserland' },
  SE: { en: 'Sweden', nl: 'Zweden' },
  DK: { en: 'Denmark', nl: 'Denemarken' },
  ES: { en: 'Spain', nl: 'Spanje' },
  IT: { en: 'Italy', nl: 'Italië' },
  IL: { en: 'Israel', nl: 'Israël' },
  AT: { en: 'Austria', nl: 'Oostenrijk' },
  FI: { en: 'Finland', nl: 'Finland' },
  NO: { en: 'Norway', nl: 'Noorwegen' },
  PT: { en: 'Portugal', nl: 'Portugal' },
  PL: { en: 'Poland', nl: 'Polen' },
  HK: { en: 'Hong Kong', nl: 'Hongkong' }
};

const SUFFIX_COUNTRY = {
  BR: 'BE', AS: 'NL', PA: 'FR', DE: 'DE', F: 'DE', MU: 'DE', HM: 'DE', DU: 'DE',
  L: 'GB', VI: 'AT', ST: 'SE', HE: 'FI', CO: 'DK', OL: 'NO', SW: 'CH',
  MI: 'IT', MC: 'ES', LS: 'PT', WA: 'PL', AX: 'AU', TO: 'CA', V: 'CA',
  HK: 'HK', SS: 'CN', SZ: 'CN', T: 'JP', US: 'US'
};

export function countryName(code, lang = 'en') {
  const row = COUNTRY[String(code || '').toUpperCase()];
  if (!row) return code || '';
  return lang === 'nl' ? row.nl : row.en;
}

export function countryCodeFromSymbol(ticker) {
  const raw = String(ticker || '');
  const suffix = raw.includes('.') ? raw.split('.').pop()?.toUpperCase() : '';
  if (suffix && SUFFIX_COUNTRY[suffix]) return SUFFIX_COUNTRY[suffix];
  return 'US';
}

function clip(s, n = 160) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function num(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function dedupeHits(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.url || item.title || '').toLowerCase().slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function looksLikeNewsNote(notes) {
  return /\b(fed|ecb|rente|rate cut|rate hike|cpi|inflatie|oorlog|conflict|china|taiwan|opec|verkiezing|election|sanctie|embargo|staking|strike|regulering|regulation)\b/i.test(notes || '');
}

function searchQueries(ticker, name, profile, notes, lang) {
  const country = countryName(profile?.country, 'en') || profile?.country || '';
  const industry = profile?.industry || profile?.sector || '';
  const who = clip(name || ticker, 80);
  const queries = [
    clip(`Federal Reserve interest rate decision stocks ${industry || who}`, 160)
  ];
  if (country && country !== 'United States') {
    queries.push(clip(`${who} ${country} ${industry} news conflict OR regulation OR strike`, 160));
  } else {
    queries.push(clip(`${who} ${industry} sector news regulation OR supply chain OR demand`, 160));
  }
  if (notes && (looksLikeNewsNote(notes) || notes.length > 12)) {
    queries.push(clip(`${ticker} ${notes}`, 160));
  }
  return [...new Set(queries.filter(Boolean))].slice(0, 3);
}

function mergeFinancials(fh, yh, quote) {
  const deRaw = num(fh?.debtToEquity, yh?.debtToEquity);
  return {
    peRatioTTM: num(fh?.peRatioTTM, yh?.peRatioTTM, quote?.pe),
    forwardPE: num(yh?.forwardPE, fh?.forwardPE),
    priceToBook: num(fh?.priceToBook, yh?.priceToBook),
    epsGrowth: num(fh?.epsGrowth, yh?.epsGrowth),
    revenueGrowth: num(fh?.revenueGrowth, yh?.revenueGrowth),
    roeTTM: num(fh?.roeTTM, yh?.roeTTM),
    debtToEquity: deRaw != null && deRaw > 10 ? deRaw / 100 : deRaw,
    currentRatio: num(fh?.currentRatio, yh?.currentRatio),
    dividendYield: num(fh?.dividendYield, yh?.dividendYield)
  };
}

function mergeProfile(fh, yh, ticker, quote, lang) {
  const country = fh?.country || yh?.country || countryCodeFromSymbol(ticker);
  const industry = fh?.industry || yh?.industry || '';
  const sector = yh?.sector || '';
  const name = fh?.name || yh?.name || quote?.name || '';
  if (!name && !country && !industry && !sector) return null;
  return {
    name,
    country,
    countryName: countryName(country, lang) || country,
    industry,
    sector,
    exchange: fh?.exchange || quote?.exchange || ''
  };
}

function summarizeInsider(rows) {
  const list = (rows || []).filter(r => r && (r.shares || r.name));
  if (!list.length) return null;
  const buys = list.filter(r => r.shares > 0 || r.code === 'P');
  const sells = list.filter(r => r.shares < 0 || r.code === 'S');
  const netShares = list.reduce((s, r) => s + (Number(r.shares) || 0), 0);
  return {
    buys: buys.length,
    sells: sells.length,
    netShares,
    recent: list.slice(0, 8).map(r => ({
      name: r.name,
      shares: r.shares,
      date: r.date,
      side: r.shares < 0 || r.code === 'S' ? 'sell' : 'buy'
    }))
  };
}

const ANNUAL_FORMS = /^(10-K|20-F|40-F|6-K|ARS|20F)$/i;
const QUARTER_FORMS = /^(10-Q|6-K)$/i;

function pickFilings(fh, yh) {
  const rows = [...(fh || []), ...(yh || [])];
  if (!rows.length) return null;
  const seen = new Set();
  const items = [];
  for (const f of rows) {
    const key = `${f.type}|${f.date}|${f.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(f);
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const annual = items.find(f => ANNUAL_FORMS.test(f.type));
  const quarter = items.find(f => QUARTER_FORMS.test(f.type) && f !== annual);
  return {
    latest: annual || items[0] || null,
    quarter: quarter || null,
    items: items.slice(0, 8)
  };
}

export function attachQuoteFallbacks(world, quote, ticker, lang = 'en') {
  const w = world || { profile: null, financials: null, hits: [], regime: null };
  w.financials = mergeFinancials(w.financials, null, quote);
  if (!w.profile) {
    w.profile = mergeProfile(null, null, ticker, quote, lang);
  } else if (!w.profile.country) {
    const code = countryCodeFromSymbol(ticker);
    w.profile = {
      ...w.profile,
      country: code,
      countryName: w.profile.countryName || countryName(code, lang)
    };
  }
  return w;
}

export async function loadWorldContext(ticker, name, { notes = '', lang = 'en' } = {}) {
  const key = `world_${ticker}_${lang}_${clip(notes, 40)}`;
  return cached(key, 6 * 60_000, async () => {
    const [profile, regime, financials, insiderFh, filingsFh, yahoo, options] = await Promise.all([
      getCompanyProfile(ticker).catch(() => null),
      getMarketRegime().catch(() => null),
      getBasicFinancials(ticker).catch(() => null),
      getInsiderTransactions(ticker).catch(() => null),
      getFilings(ticker).catch(() => null),
      getYahooDeskFundamentals(ticker).catch(() => null),
      getYahooOptionsSnapshot(ticker).catch(() => null)
    ]);
    const mergedProfile = mergeProfile(profile, yahoo?.profile, ticker, null, lang);
    const resolvedName = name || mergedProfile?.name || ticker;
    const queries = searchQueries(ticker, resolvedName, mergedProfile, notes, lang);
    const batches = await Promise.all(
      queries.map(q => webSearch(q, { lang, maxResults: 4 }).catch(() => []))
    );
    return {
      profile: mergedProfile,
      regime: regime || null,
      financials: mergeFinancials(financials, yahoo?.financials, null),
      insider: summarizeInsider([...(insiderFh || []), ...(yahoo?.insider || [])]),
      filings: pickFilings(filingsFh, yahoo?.filings),
      options: options || null,
      hits: dedupeHits(batches.flat()).slice(0, 8),
      queries
    };
  });
}

function money(n, lang) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const s = Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
  return lang === 'nl' ? s.replace('.', ',') : s;
}

export function formatWorldBlock(world, lang = 'en') {
  if (!world) return '';
  const nl = lang === 'nl';
  const lines = [];
  if (world.regime) {
    lines.push(`Regime: ${world.regime.label || 'n/a'} · VIX ${world.regime.vixLevel || 'n/a'}`);
  }
  if (world.profile) {
    const bits = [
      world.profile.name,
      world.profile.countryName || world.profile.country,
      world.profile.industry || world.profile.sector
    ].filter(Boolean);
    if (bits.length) lines.push(nl ? `Bedrijf: ${bits.join(' · ')}` : `Company: ${bits.join(' · ')}`);
  }
  if (world.financials) {
    const pe = world.financials.peRatioTTM;
    const fwd = world.financials.forwardPE;
    const growth = world.financials.revenueGrowth;
    const bits = [];
    if (pe != null) bits.push(`P/E ${money(pe, lang)}`);
    if (fwd != null) bits.push(nl ? `forward ${money(fwd, lang)}` : `fwd ${money(fwd, lang)}`);
    if (growth != null) bits.push(nl
      ? `omzetgroei ${(Number(growth) * 100).toFixed(0)}%`
      : `rev growth ${(Number(growth) * 100).toFixed(0)}%`);
    if (bits.length) lines.push(nl ? `Waardering: ${bits.join(' · ')}` : `Valuation: ${bits.join(' · ')}`);
  }
  if (world.insider) {
    const net = world.insider.netShares;
    const dir = net > 0 ? (nl ? 'netto koop' : 'net buying') : net < 0 ? (nl ? 'netto verkoop' : 'net selling') : (nl ? 'neutraal' : 'flat');
    lines.push(nl
      ? `Insiders (90d): ${dir} · ${world.insider.buys} koop / ${world.insider.sells} verkoop`
      : `Insiders (90d): ${dir} · ${world.insider.buys} buys / ${world.insider.sells} sells`);
  }
  if (world.filings?.latest) {
    const f = world.filings.latest;
    const q = world.filings.quarter;
    lines.push(nl
      ? `Rapport: ${f.type} ${f.date}${q ? ` · ${q.type} ${q.date}` : ''}`
      : `Filings: ${f.type} ${f.date}${q ? ` · ${q.type} ${q.date}` : ''}`);
  }
  if (world.options) {
    const o = world.options;
    const bits = [];
    if (o.putCallVolume != null) bits.push(`put/call ${money(o.putCallVolume, lang)}`);
    if (o.impliedVol != null) bits.push(`IV ${(Number(o.impliedVol) * 100).toFixed(0)}%`);
    if (bits.length) lines.push(nl ? `Opties: ${bits.join(' · ')}` : `Options: ${bits.join(' · ')}`);
  }
  const hits = (world.hits || []).slice(0, 6);
  if (!hits.length) {
    lines.push(nl ? 'Geen extra wereldhits.' : 'No extra world hits.');
    return lines.join('\n');
  }
  hits.forEach((h, i) => {
    const body = h.content ? ` — ${clip(h.content, 220)}` : '';
    lines.push(`${i + 1}. ${h.title}${body}`);
  });
  return lines.join('\n');
}
