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

function valuationLine(fin, quote, lang) {
  const pe = fin?.peRatioTTM ?? quote?.pe;
  if (pe == null) return null;
  const nl = lang === 'nl';
  const bits = [`P/E ${money(pe, lang)}`];
  if (fin?.forwardPE != null) bits.push(nl ? `forward ${money(fin.forwardPE, lang)}` : `fwd ${money(fin.forwardPE, lang)}`);
  if (fin?.priceToBook != null) bits.push(`P/B ${money(fin.priceToBook, lang)}`);
  return bits.join(' · ');
}

function profileLine(profile, lang) {
  if (!profile) return null;
  const bits = [
    profile.name,
    profile.countryName || countryName(profile.country, lang) || profile.country,
    profile.industry || profile.sector
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

function insiderLine(insider, lang) {
  if (!insider) return null;
  const nl = lang === 'nl';
  if (insider.buys || insider.sells) {
    const net = insider.netShares || 0;
    const dir = net > 0 ? (nl ? 'netto koop' : 'net buying') : net < 0 ? (nl ? 'netto verkoop' : 'net selling') : (nl ? 'neutraal' : 'flat');
    return `${dir} · ${insider.buys} ${nl ? 'koop' : 'buys'} / ${insider.sells} ${nl ? 'verkoop' : 'sells'}`;
  }
  const n = insider.form4 || insider.recent?.length || 0;
  if (!n) return null;
  return nl ? `${n} Form-4 in 90 dagen` : `${n} Form 4 filings in 90 days`;
}

function filingsLine(filings) {
  if (!filings?.latest) return null;
  const f = filings.latest;
  const q = filings.quarter;
  return [f.type, f.date, q ? `${q.type} ${q.date}` : ''].filter(Boolean).join(' · ');
}

function optionsLine(options, lang) {
  if (!options) return null;
  const bits = [];
  if (options.putCallVolume != null) bits.push(`put/call ${money(options.putCallVolume, lang)}`);
  if (options.impliedVol != null) bits.push(`IV ${(Number(options.impliedVol) * 100).toFixed(0)}%`);
  if (options.expiry) bits.push(options.expiry);
  return bits.length ? bits.join(' · ') : null;
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
  const insider = world?.insider;
  const filings = world?.filings;
  const options = world?.options;
  const hits = (world?.hits || []).map(h => ({
    title: h.title,
    url: h.url,
    source: h.source,
    summary: h.content || ''
  })).filter(h => h.title);
  const valuation = valuationLine(fin, quote, locale);
  const company = profileLine(profile, locale);
  const insiderText = insiderLine(insider, locale);
  const filingText = filingsLine(filings);
  const optionsText = optionsLine(options, locale);

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
    used('profile', nl ? 'Land / sector' : 'Country / sector', company),
    used('valuation', nl ? 'Waardering (K/W)' : 'Valuation (P/E)', valuation),
    used('insider', nl ? 'Insidertransacties' : 'Insider trades', insiderText),
    used('filings', nl ? 'Jaarverslag / 10-K' : 'Filings / 10-K', filingText),
    used('options', nl ? 'Opties (put/call)' : 'Options (put/call)', optionsText),
    used('world', nl ? 'Wereld / macro' : 'World / macro',
      hits.length ? `${hits.length} ${nl ? 'hits buiten de ticker-koppen' : 'hits beyond ticker headlines'}` : null),
    used('notes', nl ? 'Jouw noot' : 'Your note', clipNotes(notes) || null)
  ].filter(Boolean);

  const skipped = [
    !valuation && missing('valuation', nl ? 'Waardering (K/W)' : 'Valuation (P/E)',
      nl ? 'geen K/W-cijfer voor dit aandeel' : 'no P/E figure for this ticker'),
    !regime && missing('regime', nl ? 'Marktregime' : 'Market regime',
      nl ? 'SPY/VIX niet geladen' : 'SPY/VIX not loaded'),
    !company && missing('profile', nl ? 'Land / sector' : 'Country / sector',
      nl ? 'geen bedrijfsprofiel opgehaald' : 'no company profile fetched'),
    !hits.length && missing('world', nl ? 'Wereld / geo / sector' : 'World / geo / sector',
      nl ? 'geen extra zoekhits deze ronde' : 'no extra search hits this pass'),
    !optionsText && missing('options', nl ? 'Opties (put/call)' : 'Options (put/call)',
      nl ? 'geen optieketen voor dit aandeel' : 'no option chain for this ticker'),
    !filingText && missing('filings', nl ? 'Jaarverslag / 10-K' : 'Filings / 10-K',
      nl ? 'geen recente deponering gevonden' : 'no recent filing found'),
    !insiderText && missing('insider', nl ? 'Insidertransacties' : 'Insider trades',
      nl ? 'geen insiderdeals in de laatste 90 dagen' : 'no insider trades in the last 90 days')
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
    headlines: headlines.slice(0, 8),
    world: hits.slice(0, 6),
    insider: insider?.recent || [],
    filings: filings?.items || [],
    options
  };
}
