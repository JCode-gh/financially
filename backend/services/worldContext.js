import { getCompanyProfile, getBasicFinancials } from './finnhub.js';
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
  IL: { en: 'Israel', nl: 'Israël' }
};

export function countryName(code, lang = 'en') {
  const row = COUNTRY[String(code || '').toUpperCase()];
  if (!row) return code || '';
  return lang === 'nl' ? row.nl : row.en;
}

function clip(s, n = 160) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
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
  const industry = profile?.industry || '';
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

export async function loadWorldContext(ticker, name, { notes = '', lang = 'en' } = {}) {
  const key = `world_${ticker}_${lang}_${clip(notes, 40)}`;
  return cached(key, 6 * 60_000, async () => {
    const [profile, regime, financials] = await Promise.all([
      getCompanyProfile(ticker).catch(() => null),
      getMarketRegime().catch(() => null),
      getBasicFinancials(ticker).catch(() => null)
    ]);
    const resolvedName = name || profile?.name || ticker;
    const queries = searchQueries(ticker, resolvedName, profile, notes, lang);
    const batches = await Promise.all(
      queries.map(q => webSearch(q, { lang, maxResults: 4 }).catch(() => []))
    );
    return {
      profile: profile ? { ...profile, countryName: countryName(profile.country, lang) } : null,
      regime: regime || null,
      financials: financials || null,
      hits: dedupeHits(batches.flat()).slice(0, 8),
      queries
    };
  });
}

export function formatWorldBlock(world, lang = 'en') {
  if (!world) return '';
  const lines = [];
  if (world.regime) {
    lines.push(lang === 'nl'
      ? `Regime: ${world.regime.label || 'n/a'} · VIX ${world.regime.vixLevel || 'n/a'}`
      : `Regime: ${world.regime.label || 'n/a'} · VIX ${world.regime.vixLevel || 'n/a'}`);
  }
  if (world.profile) {
    const bits = [
      world.profile.name,
      world.profile.countryName || world.profile.country,
      world.profile.industry
    ].filter(Boolean);
    if (bits.length) {
      lines.push(lang === 'nl' ? `Bedrijf: ${bits.join(' · ')}` : `Company: ${bits.join(' · ')}`);
    }
  }
  if (world.financials) {
    const pe = world.financials.peRatioTTM;
    const growth = world.financials.revenueGrowth;
    const bits = [];
    if (pe != null) bits.push(`P/E ${Number(pe).toFixed(1)}`);
    if (growth != null) bits.push(lang === 'nl'
      ? `omzetgroei ${(Number(growth) * 100).toFixed(0)}%`
      : `rev growth ${(Number(growth) * 100).toFixed(0)}%`);
    if (bits.length) lines.push(bits.join(' · '));
  }
  const hits = (world.hits || []).slice(0, 6);
  if (!hits.length) {
    lines.push(lang === 'nl' ? 'Geen extra wereldhits.' : 'No extra world hits.');
    return lines.join('\n');
  }
  hits.forEach((h, i) => {
    const body = h.content ? ` — ${clip(h.content, 220)}` : '';
    lines.push(`${i + 1}. ${h.title}${body}`);
  });
  return lines.join('\n');
}
