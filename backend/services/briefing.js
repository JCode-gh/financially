import { createHash } from 'crypto';
import { countryName } from './worldContext.js';

export const BRIEF_STYLES = ['desk', 'plain', 'skeptic', 'detailed'];

export function normalizeStyle(raw) {
  const s = String(raw || 'desk').toLowerCase().trim();
  return BRIEF_STYLES.includes(s) ? s : 'desk';
}

export function clipNotes(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function briefCacheTag(style, notes) {
  const s = normalizeStyle(style);
  const n = clipNotes(notes);
  if (!n && s === 'desk') return 'desk';
  const hash = createHash('sha1').update(`${s}|${n}`).digest('hex').slice(0, 10);
  return `${s}_${n ? hash : '0'}`;
}

function money(n, lang) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return lang === 'nl' ? s.replace('.', ',') : s;
}

function pct(n, lang) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const sign = Number(n) >= 0 ? '+' : '';
  const body = `${sign}${Number(n).toFixed(2)}%`;
  return lang === 'nl' ? body.replace('.', ',') : body;
}

function used(id, label, value) {
  if (value == null || value === '') return null;
  return { id, label, value: String(value) };
}

function missing(id, label, why) {
  return { id, label, why };
}

export function buildBriefing({
  result,
  quote,
  articles,
  world,
  style,
  notes,
  notesReply,
  notesImpact,
  claimCheck,
  lang = 'en'
}) {
  const locale = lang === 'nl' ? 'nl' : 'en';
  const nl = locale === 'nl';
  const price = result?.indicators?.price ?? quote?.price;
  const day = quote?.changePct;
  const priceValue = price != null
    ? `${money(price, locale)}${day != null ? ` · ${nl ? 'dag' : 'day'} ${pct(day, locale)}` : ''}`
    : null;
  const sup = result?.indicators?.support;
  const res = result?.indicators?.resistance;
  const levels = (sup != null || res != null)
    ? `${nl ? 'steun' : 'support'} ${money(sup, locale) ?? '—'} / ${nl ? 'weerstand' : 'resistance'} ${money(res, locale) ?? '—'}`
    : null;
  const five = result?.predictions?.find(p => p.horizon === '5d') || result?.predictions?.[1];
  const newsN = (articles || []).length;
  const newsLabel = result?.newsSentiment?.label || (nl ? 'neutraal' : 'neutral');
  const newsScore = result?.newsSentiment?.score;
  const headlines = (articles || []).slice(0, 8).map(a => ({
    title: a.headline || a.title || '',
    source: a.source || '',
    url: a.url || a.link || ''
  })).filter(h => h.title);
  const profile = world?.profile;
  const regime = world?.regime;
  const fin = world?.financials;
  const hits = (world?.hits || []).map(h => ({
    title: h.title,
    url: h.url,
    source: h.source,
    summary: h.content || ''
  })).filter(h => h.title);

  const considered = [
    used('price', nl ? 'Koers' : 'Price', priceValue),
    used('trend', nl ? 'Trend' : 'Trend', result?.trend?.label || null),
    used('levels', nl ? 'Steun / weerstand' : 'Support / resistance', levels),
    used('news', nl ? 'Nieuwssentiment' : 'News sentiment',
      newsN ? `${newsLabel}${newsScore != null ? ` (${Number(newsScore).toFixed(2)})` : ''} · ${newsN} ${nl ? 'koppen' : 'headlines'}` : null),
    used('quant', nl ? 'Model 5 dagen' : '5-day model',
      five?.prediction ? `${five.prediction}${five.targetPrice != null ? ` · ${nl ? 'doel' : 'target'} ${money(five.targetPrice, locale)}` : ''}` : null),
    used('regime', nl ? 'Marktregime' : 'Market regime',
      regime ? `${regime.label || 'n/a'}${regime.vixLevel ? ` · VIX ${regime.vixLevel}` : ''}` : null),
    used('profile', nl ? 'Bedrijf' : 'Company',
      profile ? [profile.name, profile.countryName || countryName(profile.country, locale), profile.industry].filter(Boolean).join(' · ') : null),
    used('valuation', nl ? 'Waardering' : 'Valuation',
      fin?.peRatioTTM != null ? `P/E ${Number(fin.peRatioTTM).toFixed(1)}` : null),
    used('world', nl ? 'Wereld / macro' : 'World / macro',
      hits.length ? `${hits.length} ${nl ? 'hits buiten de ticker-koppen' : 'hits beyond ticker headlines'}` : null),
    used('notes', nl ? 'Jouw noot' : 'Your note', clipNotes(notes) || null)
  ].filter(Boolean);

  const skipped = [
    !fin?.peRatioTTM && missing('valuation', nl ? 'Waardering (K/W)' : 'Valuation (P/E)',
      nl ? 'geen cijfer opgehaald voor dit aandeel' : 'no figure fetched for this ticker'),
    !regime && missing('regime', nl ? 'Marktregime' : 'Market regime',
      nl ? 'SPY/VIX niet geladen' : 'SPY/VIX not loaded'),
    !profile && missing('profile', nl ? 'Land / sector' : 'Country / sector',
      nl ? 'geen bedrijfsprofiel (Finnhub)' : 'no company profile (Finnhub)'),
    !hits.length && missing('world', nl ? 'Wereld / geo / sector' : 'World / geo / sector',
      nl ? 'geen extra zoekhits deze ronde' : 'no extra search hits this pass'),
    missing('options', nl ? 'Optieflow / orderboek' : 'Options flow / order book',
      nl ? 'zit niet in deze desk' : 'not in this desk'),
    missing('filings', nl ? 'Jaarverslag / 10-K' : 'Filings / 10-K',
      nl ? 'niet ingelezen' : 'not read'),
    missing('insider', nl ? 'Insidertransacties' : 'Insider trades',
      nl ? 'niet ingelezen' : 'not read')
  ].filter(Boolean);

  return {
    style: normalizeStyle(style),
    notes: clipNotes(notes),
    notesReply: String(notesReply || '').trim().slice(0, 240),
    notesImpact: notesImpact === 'tilted' || notesImpact === 'changed' ? notesImpact : 'none',
    claimCheck: claimCheck === 'confirmed' || claimCheck === 'contradicted' || claimCheck === 'unverified'
      ? claimCheck
      : 'none',
    considered,
    skipped,
    headlines: headlines.slice(0, 6),
    world: hits.slice(0, 6)
  };
}
