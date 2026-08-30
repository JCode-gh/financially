import { t } from '../i18n/index.js';
import { formatPrice } from './format.js';

export function stripWeight(text) {
  return String(text || '').replace(/\s*\(weight[^)]*\)/gi, '').trim();
}

function direction(text) {
  if (/bearish/i.test(text)) return 'down';
  if (/bullish/i.test(text)) return 'up';
  return null;
}

const REASON_RULES = [
  { test: /sma crossover/i, key: 'sma' },
  { test: /ema crossover/i, key: 'ema' },
  { test: /price momentum/i, key: 'momentum' },
  { test: /trend regime/i, key: 'trend' },
  { test: /volume trend/i, key: 'volume' },
  { test: /macd/i, key: 'macd' },
  { test: /rsi/i, key: 'rsi' },
  { test: /stochastic/i, key: 'stoch' },
  { test: /bollinger/i, key: 'bb' },
  { test: /breakout/i, key: 'breakout' },
  { test: /adx|trend strength/i, key: 'adx' },
  { test: /money flow/i, key: 'mfi' },
  { test: /news context/i, key: 'news' },
  { test: /valuation/i, key: 'valuation' },
  { test: /growth/i, key: 'growth' },
  { test: /quality/i, key: 'quality' },
  { test: /post-earnings|earnings drift/i, key: 'drift' }
];

export function simpleReason(text) {
  const raw = stripWeight(text);
  if (!raw) return '';
  const support = raw.match(/holding above support at \$([0-9]+(?:\.[0-9]+)?)/i);
  if (support) return t('picks.reasons.supportHold', { price: formatPrice(support[1]) });
  const resist = raw.match(/capped by resistance at \$([0-9]+(?:\.[0-9]+)?)/i);
  if (resist) return t('picks.reasons.resistCap', { price: formatPrice(resist[1]) });
  const week = raw.match(/trading at (\d+)% of its 52-week range/i);
  if (week) return t('picks.reasons.week52pos', { n: week[1] });
  const d = direction(raw);
  for (const rule of REASON_RULES) {
    if (rule.test.test(raw)) return t(`picks.reasons.${rule.key}.${d === 'down' ? 'down' : 'up'}`);
  }
  return raw.replace(/\s+(bullish|bearish)\s*$/i, '').trim();
}

export function setupReason(text) {
  const raw = stripWeight(text);
  if (!raw) return '';
  const adx = raw.match(/ADX\s+(\d+)/i)?.[1];
  const rsi = raw.match(/RSI\s+(\d+)/i)?.[1];
  const px = raw.match(/\$([0-9]+(?:\.[0-9]+)?)/)?.[1];

  if (/strong uptrend/i.test(raw)) return adx ? t('setup.signals.strongUptrendAdx', { adx }) : t('setup.signals.strongUptrend');
  if (/strong downtrend/i.test(raw)) return adx ? t('setup.signals.strongDowntrendAdx', { adx }) : t('setup.signals.strongDowntrend');
  if (/uptrend/i.test(raw)) return adx ? t('setup.signals.uptrendAdx', { adx }) : t('setup.signals.uptrend');
  if (/downtrend/i.test(raw)) return adx ? t('setup.signals.downtrendAdx', { adx }) : t('setup.signals.downtrend');
  if (/macd momentum falling/i.test(raw)) return t('setup.signals.macdFalling');
  if (/macd momentum rising/i.test(raw)) return t('setup.signals.macdRising');
  if (/macd bullish cross/i.test(raw)) return t('setup.signals.macdBull');
  if (/macd bearish cross/i.test(raw)) return t('setup.signals.macdBear');
  if (rsi && /overbought/i.test(raw)) return t('setup.signals.rsiOverbought', { n: rsi });
  if (rsi && /oversold/i.test(raw)) return t('setup.signals.rsiOversold', { n: rsi });
  if (rsi) return t('setup.signals.rsi', { n: rsi });
  if (/volume shows distribution/i.test(raw)) return t('setup.signals.volumeDown');
  if (/volume confirms buyers/i.test(raw)) return t('setup.signals.volumeUp');
  if (/golden cross/i.test(raw)) return t('setup.signals.goldenCross');
  if (/death cross/i.test(raw)) return t('setup.signals.deathCross');
  if (/breakout above/i.test(raw)) return t('setup.signals.breakoutUp');
  if (/breakdown below/i.test(raw)) return t('setup.signals.breakoutDown');
  if (/52-week highs/i.test(raw)) return t('setup.signals.week52High');
  if (/52-week lows/i.test(raw)) return t('setup.signals.week52Low');
  if (/resistance overhead/i.test(raw) && px) return t('setup.signals.resistanceAt', { price: formatPrice(px) });
  if (/support nearby/i.test(raw) && px) return t('setup.signals.supportAt', { price: formatPrice(px) });
  if (/stochastic/i.test(raw) && /oversold|bullish/i.test(raw)) return t('setup.signals.stochUp');
  if (/stochastic/i.test(raw)) return t('setup.signals.stochDown');
  if (/money flow washed/i.test(raw)) return t('setup.signals.mfiLow');
  if (/money flow stretched/i.test(raw)) return t('setup.signals.mfiHigh');
  if (/volume confirms/i.test(raw)) return t('setup.signals.volumeUp');
  if (/volume shows|distribution/i.test(raw)) return t('setup.signals.volumeDown');
  if (/^news\b/i.test(raw)) {
    if (/positive|bullish/i.test(raw)) return t('setup.signals.newsUp');
    if (/negative|bearish/i.test(raw)) return t('setup.signals.newsDown');
    return t('setup.signals.news');
  }
  return simpleReason(raw);
}

export function displayReason(text) {
  const weight = String(text || '').match(/\(weight[^)]*\)/i)?.[0] || '';
  const line = simpleReason(text);
  return weight ? `${line} ${weight}` : line;
}

export function simpleReasons(reasons = []) {
  const seen = new Set();
  const out = [];
  for (const reason of reasons) {
    const line = simpleReason(reason);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function nonEarningsReasons(reasons = []) {
  return reasons.filter(r => !/^earnings\b/i.test(String(r)));
}

const GENERIC_LINE_RE = /korte (trend|kracht)|short-term (trend|strength)|gemiddelden zijn om|averages just flipped|momentum (verbetert|zwakt|is improving|is fading)|RSI \d+|MACD |koers is aan het (stijgen|dalen)|zit in een (opwaartse|neerwaartse) trend|price has been (rising|falling)|it is in an (up|down)trend/i;

export function isGenericPickLine(text) {
  return GENERIC_LINE_RE.test(String(text || ''));
}

export function eventLabel(ev) {
  const id = ev?.id || ev;
  if (!id) return ev?.label || '';
  const key = `picks.events.${id}`;
  const out = t(key);
  return out === key ? (ev.label || String(id)) : out;
}

export function normalizeHeadline(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const title = raw.replace(/^Headline:\s*/i, '').trim();
    return title ? { title, url: '', source: '' } : null;
  }
  const title = String(raw.title || raw.headline || '').replace(/^Headline:\s*/i, '').trim();
  if (!title) return null;
  return { title, url: raw.url || raw.link || '', source: raw.source || '' };
}

export function pickWhy(o) {
  const seen = new Set();
  const headlines = [];
  for (const raw of [...(o.headlines || []), ...(o.reasons || []).filter(r => /^Headline:/i.test(String(r)))]) {
    const h = normalizeHeadline(raw);
    if (!h) continue;
    const key = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    headlines.push(h);
  }

  const lines = simpleReasons(nonEarningsReasons(
    (o.reasons || []).filter(r => !/^Headline:/i.test(String(r)))
  )).filter(line => line && !isGenericPickLine(line));

  const catalysts = (o.events || []).map(eventLabel).filter(Boolean);
  return { headlines, lines, catalysts };
}

export function pickLead(o) {
  const why = pickWhy(o);
  if (why.headlines[0]) {
    return { ...why.headlines[0], title: shortSentence(why.headlines[0].title, 120) };
  }
  if (why.catalysts[0]) return { title: t('picks.becauseEvent', { event: why.catalysts[0] }), url: '' };
  if (why.lines[0]) return { title: why.lines[0], url: '' };
  if (o.action === 'BUY') return { title: t('picks.headlineBuy'), url: '' };
  if (o.action === 'SELL') return { title: t('picks.headlineSell'), url: '' };
  if (o.quality === 'watch') return { title: t('picks.headlineWatch'), url: '' };
  return { title: t('picks.headlineNone'), url: '' };
}

export function pickHeadline(o) {
  return pickLead(o).title;
}

export function pickNewsItems(o) {
  const why = pickWhy(o);
  const lead = pickLead(o);
  return why.headlines.filter(h => h.title !== lead.title && shortSentence(h.title, 120) !== lead.title).slice(0, 2);
}

export function simpleFlag(flag) {
  const s = String(flag || '');
  if (/score below/i.test(s)) return t('picks.flags.score');
  if (/low confidence/i.test(s)) return t('picks.flags.confidence');
  if (/r:r|no trade plan/i.test(s)) return t('picks.flags.rr');
  if (/earnings/i.test(s)) return t('picks.flags.earnings');
  if (/against prevailing/i.test(s)) return t('picks.flags.trend');
  if (/choppy/i.test(s)) return t('picks.flags.chop');
  if (/decile|rank/i.test(s)) return t('picks.flags.rank');
  return s;
}

export function earningsLine(days) {
  if (days == null || days < 0 || days > 7) return null;
  if (days === 0) return t('picks.earningsToday');
  if (days === 1) return t('picks.earningsTomorrow');
  return t('picks.earningsIn', { n: days });
}

export function shortSentence(text, max = 88) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const sentence = raw.split(/(?<=[.!?])\s+/)[0] || raw;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}
