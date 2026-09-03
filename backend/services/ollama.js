import axios from 'axios';
import { normalizeLang, textMatchesLang } from '../lib/locale.js';
import { isUsefulText } from '../lib/articleBody.js';

const HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const WANTED = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const SEARCH_WANTED = (process.env.OLLAMA_SEARCH_MODEL || '').trim();
const TIMEOUT = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
const FALLBACKS = ['llama3.2', 'llama3.1', 'llama3', 'qwen2.5', 'qwen2', 'mistral', 'gemma3', 'gemma2'];
const SEARCH_FALLBACKS = ['qwen3:4b', 'qwen3', 'qwen2.5:3b', 'llama3.2'];

let activeModel = WANTED;
let searchModel = SEARCH_WANTED || WANTED;
let lastPing = { ok: false, model: WANTED, searchModel, at: 0 };

function isChatModel(name) {
  return !/embed|vision/i.test(name);
}

function matchModel(names, wanted) {
  if (!wanted) return '';
  return names.find(n => n === wanted || n === `${wanted}:latest` || n.startsWith(`${wanted}:`));
}

function pickInstalledModel(names) {
  const chat = (names || []).filter(isChatModel);
  return matchModel(chat, WANTED) || FALLBACKS.map(w => matchModel(chat, w)).find(Boolean) || chat[0] || '';
}

function pickSearchModel(names, chatModel) {
  const chat = (names || []).filter(isChatModel);
  if (SEARCH_WANTED) return matchModel(chat, SEARCH_WANTED) || chatModel;
  return SEARCH_FALLBACKS.map(w => matchModel(chat, w)).find(Boolean) || chatModel;
}

export function ollamaHost() {
  return HOST;
}

export function ollamaConfig() {
  return { host: HOST, model: activeModel, searchModel };
}

export function currentOllamaModel() {
  return activeModel;
}

export function currentSearchModel() {
  return searchModel || activeModel;
}

export async function pingOllama() {
  try {
    const res = await axios.get(`${HOST}/api/tags`, { timeout: 2500 });
    const names = (res.data?.models || []).map(m => m.name);
    const chosen = pickInstalledModel(names);
    activeModel = chosen || WANTED;
    searchModel = pickSearchModel(names, activeModel) || activeModel;
    lastPing = {
      ok: !!chosen,
      model: activeModel,
      searchModel,
      wanted: WANTED,
      searchWanted: SEARCH_WANTED || null,
      models: names,
      at: Date.now()
    };
    return lastPing;
  } catch {
    lastPing = { ok: false, model: activeModel, searchModel, wanted: WANTED, at: Date.now() };
    return lastPing;
  }
}

async function ensureModel() {
  if (lastPing.ok && Date.now() - lastPing.at < 60_000) return;
  await pingOllama();
  if (!lastPing.ok) throw new Error(`Ollama offline (${activeModel})`);
}

export async function ensureOllamaReady() {
  await ensureModel();
}

export function lastOllamaStatus() {
  return lastPing;
}

function compactSignals(signals = {}) {
  return Object.entries(signals)
    .filter(([, v]) => typeof v === 'number' && Math.abs(v) >= 0.15)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8)
    .map(([k, v]) => `${k}:${v > 0 ? '+' : ''}${v.toFixed(2)}`)
    .join(', ');
}

function readableBlob(d) {
  return [d?.thesis, d?.doNow, ...(d?.why || []), ...(d?.risks || []), ...(d?.catalysts || [])]
    .filter(Boolean)
    .join(' ');
}

function decisionMatchesLang(decision, lang) {
  const blob = readableBlob(decision);
  if (blob.trim().length < 16) return false;
  return textMatchesLang(blob, lang);
}

function systemPrompt(lang) {
  if (lang === 'nl') {
    return `Je geeft alleen geldige JSON. Geen markdown. Geen verzonnen feiten.
TAAL: Nederlands. thesis, doNow, why, risks en catalysts zijn 100% Nederlands.
Geen Engelse zinnen, ook niet als de input of de headlines Engels zijn.
action blijft BUY, SELL of HOLD. disagreement blijft none of news_vs_tech.
VERBODEN: vage zinnen ("de prijs kan dalen", "er zijn risico's", "het is belangrijk om te onthouden", "niet meer winstgevend").
VERBODEN: RSI, MACD, ADX, SMA, EMA, 52-weekspositie in de tekst. Cijfers uit de data wél gebruiken (koers, % dag, steun, weerstand).
Schrijf verzorgd Nederlands: juiste de/het, geen Engelse leenwoorden (uptrend, productlaunch, support, resistance), geen verhaspelde werkwoorden (gesteegd). Cijfers met komma (1,32%).
action en doNow moeten hetzelfde zeggen. BUY = koop/instap. SELL = verkoop/verklein. HOLD = niet bijkopen/wacht.`;
  }
  return `You output only valid JSON. No markdown. No invented facts.
LANGUAGE: English. thesis, doNow, why, risks and catalysts must be 100% English.
Do not write Dutch, even if headlines or company names are Dutch.
action stays BUY, SELL or HOLD. disagreement stays none or news_vs_tech.
BANNED: vague lines ("the price can fall", "there are risks", "it is important to remember", "no longer profitable").
BANNED: RSI, MACD, ADX, SMA, EMA in the prose. Do use numbers from the data (price, day %, support, resistance).
action and doNow must agree. BUY = buy/add. SELL = sell/trim. HOLD = do not add / wait.`;
}

function headlineLines(ctx) {
  return (ctx.headlines || []).slice(0, 8).map((h, i) => {
    if (typeof h === 'string') return `${i + 1}. ${h}`;
    const extra = h.summary ? ` — ${h.summary}` : '';
    return `${i + 1}. ${h.headline}${extra}`;
  }).join('\n');
}

function trendPhrase(trend, lang) {
  const t = String(trend || '').toLowerCase();
  if (!t || t === 'n/a') return '';
  if (lang === 'nl') {
    if (t.includes('strong up')) return 'sterke opwaartse trend';
    if (t.includes('up')) return 'opwaartse trend';
    if (t.includes('strong down')) return 'sterke neerwaartse trend';
    if (t.includes('down')) return 'neerwaartse trend';
    return 'zijwaartse markt';
  }
  return trend;
}

function nlNum(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toFixed(digits).replace('.', ',');
}

function buildPrompt(ctx, lang) {
  const headlines = headlineLines(ctx);
  const five = ctx.fiveDay || {};
  const dayEn = ctx.dayChange == null ? 'n/a' : `${ctx.dayChange >= 0 ? '+' : ''}${Number(ctx.dayChange).toFixed(2)}%`;
  const dayNl = ctx.dayChange == null ? 'n/a' : `${ctx.dayChange >= 0 ? '+' : ''}${nlNum(ctx.dayChange)}%`;
  const trendNl = trendPhrase(ctx.trend, 'nl') || 'n/a';
  const factsNl = `AANDEEL: ${ctx.ticker} (${ctx.name || ctx.ticker})
KOERS: ${nlNum(ctx.price) ?? ctx.price}   DAG: ${dayNl}
TREND: ${trendNl}
STEUN: ${nlNum(ctx.support) ?? 'n/a'}   WEERSTAND: ${nlNum(ctx.resistance) ?? 'n/a'}
NIEUWSSENTIMENT: ${ctx.newsLabel || 'neutraal'} (${ctx.newsScore ?? 0})
KOPPEN OVER ${ctx.ticker}:
${headlines || '(geen kop die dit aandeel noemt)'}

ALLEEN VOOR JE OORDEEL, NIET OVERNEMEN IN DE TEKST:
RSI ${ctx.rsi ?? 'n/a'} · ADX ${ctx.adx ?? 'n/a'} · 52w ${ctx.week52 ?? 'n/a'}
QUANT 5D ${five.prediction || 'n/a'} score ${five.score ?? 'n/a'} target ${five.targetPrice ?? 'n/a'}
PLAN: ${ctx.tradePlan || 'geen'}
SIGNALEN: ${compactSignals(ctx.signals)}
REDENEN: ${(ctx.reasons || []).slice(0, 5).map(r => `- ${r}`).join('\n') || '-'}`;

  const factsEn = `TICKER: ${ctx.ticker}
NAME: ${ctx.name || ctx.ticker}
PRICE: ${ctx.price}  DAY: ${dayEn}
TREND: ${ctx.trend || 'n/a'}
SUPPORT: ${ctx.support ?? 'n/a'}  RESISTANCE: ${ctx.resistance ?? 'n/a'}
NEWS SENTIMENT: ${ctx.newsLabel || 'neutral'} (${ctx.newsScore ?? 0})
HEADLINES ABOUT ${ctx.ticker}:
${headlines || '(none that name this ticker)'}

JUDGE ONLY, DO NOT PASTE INTO THE PROSE:
RSI ${ctx.rsi ?? 'n/a'} · ADX ${ctx.adx ?? 'n/a'} · 52w ${ctx.week52 ?? 'n/a'}
QUANT 5D ${five.prediction || 'n/a'} score ${five.score ?? 'n/a'} target ${five.targetPrice ?? 'n/a'}
PLAN: ${ctx.tradePlan || 'none'}
SIGNALS: ${compactSignals(ctx.signals)}
REASONS:
${(ctx.reasons || []).slice(0, 5).map(r => `- ${r}`).join('\n') || '-'}`;

  if (lang === 'nl') {
    return `Je bent een analist van de handelsdesk. Geef een belegger een duidelijk BUY, SELL of HOLD voor de komende 1-10 sessies.
Wees eerlijk. Zwakke of gemengde tape = HOLD. Verzin geen feiten, data, koersen of katalysatoren. Gebruik alleen de data hieronder.
Nieuws telt alleen als het over DIT aandeel gaat. Als nieuws en techniek botsen, zeg dat en verlaag de overtuiging.
Conviction 70+ alleen als tape en nieuws het eens zijn. 40 of lager als het voordeel dun is.

FOUT (nooit zo schrijven):
- BUY plus "houd je aandelen" of "kijk uit naar een stijging"
- risico = "de prijs kan dalen" / "niet meer winstgevend"
- thesis herhalen in why
- RSI/MACD uitleggen
- "het aandeel is gekozen/verkozen" — dat betekent niks

GOED:
- thesis: wat er nu speelt + welk niveau de call maakt of breekt, met echte cijfers
- doNow: één werkwoord dat bij action hoort (Koop / Verkoop / Wacht)
- why: 2 andere feiten uit de data of één headline-thema, geen herhaling
- risks: een concreet niveau of een concreet nieuwsfeit

TAAL (verplicht): verzorgd krantennederlands. Juiste de/het. Geen Engels (uptrend, productlaunch, support).
Geen 52-weekspositie, geen RSI. Cijfers met komma. action blijft BUY, SELL of HOLD.

${factsNl}

Geef alleen JSON:
{"action":"BUY|SELL|HOLD","conviction":0-100,"thesis":"twee Nederlandse zinnen met een niveau of een nieuwsfeit","doNow":"Koop/Verkoop/Wacht + voorwaarde voor de volgende sessie","why":["feit 1","feit 2"],"risks":["concreet risico"],"catalysts":["volgende echte trigger of weglaten"],"disagreement":"none|news_vs_tech"}`;
  }

  return `You are a trading-desk analyst. Give a trader a clear BUY, SELL, or HOLD for the next 1-10 sessions.
Be honest. Weak or mixed tape = HOLD. Do not invent facts, dates, prices, or catalysts. Use only the data below.
News only counts if it is about THIS ticker. If news and technicals disagree, say so and cut conviction.
Conviction 70+ only when tape and news agree. 40 or below if the edge is thin.

BAD (never write this):
- BUY plus "hold your shares" or "watch for a rise"
- risk = "the price can fall" / "no longer profitable"
- repeating the thesis in why
- explaining RSI/MACD

GOOD:
- thesis: what is happening now + the level that makes or breaks the call, with real numbers
- doNow: one verb that matches action (Buy / Sell / Wait)
- why: 2 other facts from the data or one headline theme, no repeats
- risks: a concrete level or a concrete news item

LANGUAGE (required): natural English. No Dutch. No indicator jargon.
action stays BUY, SELL or HOLD.

${factsEn}

Return JSON only:
{"action":"BUY|SELL|HOLD","conviction":0-100,"thesis":"two English sentences with a level or a news fact","doNow":"Buy/Sell/Wait + a condition for the next session","why":["fact 1","fact 2"],"risks":["concrete risk"],"catalysts":["next real trigger or omit"],"disagreement":"none|news_vs_tech"}`;
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function moneyNl(n) {
  const s = money(n);
  return s ? s.replace('.', ',') : null;
}

function firstHeadline(ctx) {
  const h = (ctx.headlines || [])[0];
  if (!h) return '';
  return typeof h === 'string' ? h : (h.headline || '');
}

function fallbackDoNow(action, ctx, lang) {
  const sup = lang === 'nl' ? moneyNl(ctx.support) : money(ctx.support);
  const res = lang === 'nl' ? moneyNl(ctx.resistance) : money(ctx.resistance);
  if (lang === 'nl') {
    if (action === 'BUY') {
      return sup
        ? `Koop alleen als de koers boven ${sup} blijft; daaronder laten lopen.`
        : 'Koop een kleine positie bij de volgende sessie; niet najagen.';
    }
    if (action === 'SELL') {
      return res
        ? `Verkoop of verklein als de koers ${res} niet weet te breken.`
        : 'Verklein de positie bij de volgende sessie; niet bijkopen.';
    }
    return sup && res
      ? `Niet bijkopen. Wacht tot de koers een kant kiest rond ${sup}–${res}.`
      : 'Niet bijkopen. Wacht op een duidelijker moment.';
  }
  if (action === 'BUY') {
    return sup
      ? `Buy only if price holds above ${sup}; otherwise stand aside.`
      : 'Buy a small position next session; do not chase.';
  }
  if (action === 'SELL') {
    return res
      ? `Sell or trim if price cannot break ${res}.`
      : 'Trim next session; do not add.';
  }
  return sup && res
    ? `Do not add. Wait for a break of ${sup}–${res}.`
    : 'Do not add. Wait for a cleaner setup.';
}

function factThesis(ctx, action, lang) {
  const name = ctx.name || ctx.ticker;
  const tape = trendPhrase(ctx.trend, lang);
  if (lang === 'nl') {
    const day = ctx.dayChange == null ? null : `${ctx.dayChange >= 0 ? '+' : ''}${nlNum(ctx.dayChange)}%`;
    const move = day ? `${name} staat vandaag ${day}` : name;
    const tapeBit = tape ? ` en zit in een ${tape}` : '';
    const sup = moneyNl(ctx.support);
    const res = moneyNl(ctx.resistance);
    if (action === 'BUY') {
      return `${move}${tapeBit}. Long blijven is logisch zolang de koers boven ${sup || 'steun'} blijft.`.slice(0, 400);
    }
    if (action === 'SELL') {
      return `${move}${tapeBit}. Het voordeel is short tot de koers ${res || 'weerstand'} terugpakt.`.slice(0, 400);
    }
    return `${move}${tapeBit}. Geen duidelijk voordeel — wacht op een schonere setup rond ${sup || '?'} / ${res || '?'}.`.slice(0, 400);
  }
  const day = ctx.dayChange == null ? null : `${ctx.dayChange >= 0 ? '+' : ''}${Number(ctx.dayChange).toFixed(2)}%`;
  const move = day ? `${name} is ${day} on the day` : name;
  const tapeBit = tape ? ` (${tape})` : '';
  const news = firstHeadline(ctx);
  const newsBit = news ? ` News that counts: ${news}` : '';
  const sup = money(ctx.support);
  const res = money(ctx.resistance);
  if (action === 'BUY') {
    return `${move}${tapeBit}. Stay long only while price holds above ${sup || 'support'}.${newsBit}`.slice(0, 400);
  }
  if (action === 'SELL') {
    return `${move}${tapeBit}. The edge is short until price reclaims ${res || 'resistance'}.${newsBit}`.slice(0, 400);
  }
  return `${move}${tapeBit}. No clear edge — wait for a cleaner setup around ${sup || '?'} / ${res || '?'}.${newsBit}`.slice(0, 400);
}

function factWhy(ctx, lang) {
  const out = [];
  if (ctx.dayChange != null && Math.abs(Number(ctx.dayChange)) >= 0.4) {
    const d = lang === 'nl'
      ? `${Number(ctx.dayChange) >= 0 ? '+' : ''}${nlNum(ctx.dayChange)}%`
      : `${Number(ctx.dayChange) >= 0 ? '+' : ''}${Number(ctx.dayChange).toFixed(2)}%`;
    out.push(lang === 'nl' ? `Dagkoers ${d}` : `Session move ${d}`);
  }
  if (ctx.support != null) {
    out.push(lang === 'nl' ? `Steun rond ${moneyNl(ctx.support)}` : `Support near ${money(ctx.support)}`);
  }
  if (ctx.resistance != null) {
    out.push(lang === 'nl' ? `Weerstand rond ${moneyNl(ctx.resistance)}` : `Resistance near ${money(ctx.resistance)}`);
  }
  const h = firstHeadline(ctx);
  if (h && (lang !== 'nl' || textMatchesLang(h, 'nl'))) out.push(h);
  return out.slice(0, 3);
}

function factRisks(ctx, action, lang) {
  const res = lang === 'nl' ? moneyNl(ctx.resistance) : money(ctx.resistance);
  const sup = lang === 'nl' ? moneyNl(ctx.support) : money(ctx.support);
  if (lang === 'nl') {
    if (action === 'BUY' && res) return [`De koers kan afketsen op ${res}`];
    if (action === 'SELL' && sup) return [`De short faalt als ${sup} standhoudt`];
    if (sup && res) return [`De range ${sup}–${res} kan nog blijven staan`];
    return ['Koers en nieuws zijn niet eenduidig'];
  }
  if (action === 'BUY' && res) return [`Price can stall at ${res}`];
  if (action === 'SELL' && sup) return [`Short fails if ${sup} holds`];
  if (sup && res) return [`Still stuck in ${sup}–${res}`];
  return ['Tape and news are not decisive'];
}

const VAGUE_RE = /het is belangrijk|onthouden dat|risico'?s verbonden|niet meer winstgevend|aandelenprijs kan dalen|koers kan dalen|prijs kan dalen|price can (fall|drop|decline)|there are risks|important to (remember|note)|no longer profitable|not yet (overbought|overextended)|overgegaan|kijk uit naar een verhoging|keep track of|houd je aandelen|nog niet te veel|shares are not|aantrekkelijke optie|kijk op de toekomst|in de laatste sessie (?:verkozen|gekozen)|was (?:chosen|selected|picked) in the last session|\bverkozen\b/i;
const JARGON_RE = /\b(rsi|macd|adx|sma\d*|ema\d*|stochastic|bollinger|52-?we+k)/i;
const BROKEN_NL_RE = /gesteegd|wekelijke positie|de (positieve )?sentiment|\buptrend\b|\bdowntrend\b|productlaunch|52-week|support- en resistance|long-entry/i;

function cleanupDutch(s) {
  return String(s || '')
    .replace(/\bgesteegd\b/gi, 'gesteund')
    .replace(/\bproductlaunch\b/gi, 'productlancering')
    .replace(/\bproduct launch\b/gi, 'productlancering')
    .replace(/\bstrong uptrend\b/gi, 'sterke opwaartse trend')
    .replace(/\buptrend\b/gi, 'opwaartse trend')
    .replace(/\bdowntrend\b/gi, 'neerwaartse trend')
    .replace(/\bde positieve sentiment\b/gi, 'het positieve sentiment')
    .replace(/\bde sentiment\b/gi, 'het sentiment')
    .replace(/\bde positieve momentum\b/gi, 'het positieve momentum')
    .replace(/\bde momentum\b/gi, 'het momentum')
    .replace(/\been sterke kijk op de toekomst\b/gi, 'een stevige vooruitblik')
    .replace(/\bmaken een koop een aantrekkelijke optie\b/gi, 'maken kopen aantrekkelijk')
    .replace(/\bsupport- en resistance-niveaus\b/gi, 'steun- en weerstandsniveaus')
    .replace(/\blong-entry\b/gi, 'instap')
    .replace(/\bLong blijft\b/g, 'Long blijven is')
    .replace(/\bboven ([\d.,]+) houdt\b/g, 'boven $1 blijft')
    .replace(/,? en een 52[- ]we+\w* positie van [0-9]+(?:[.,][0-9]+)?(?:, wat [^.]+)?/gi, '')
    .replace(/\been 52[- ]we+\w* positie van [0-9]+(?:[.,][0-9]+)?(?:, wat [^.]+)?\.?\s*/gi, '')
    .replace(/\b(\d+)\.(\d+)%/g, '$1,$2%')
    .replace(/\b(op|rond|boven|onder|tot) (\d+)\.(\d{2})\b/g, '$1 $2,$3')
    .replace(/[^.?!]*\b(?:verkozen|gekozen)\b[^.?!]*[.?!]?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .replace(/\s+,/g, ',')
    .trim()
    .replace(/([^.!?])$/, '$1.');
}

function looksBrokenDutch(s) {
  return BROKEN_NL_RE.test(s) || JARGON_RE.test(s);
}

function isVague(s) {
  const t = String(s || '').trim();
  return t.length < 14 || VAGUE_RE.test(t);
}

function wordOverlap(a, b) {
  const words = s => String(s).toLowerCase().split(/\W+/).filter(w => w.length > 4);
  const A = words(a);
  const B = new Set(words(b));
  if (A.length < 3) return 0;
  return A.filter(w => B.has(w)).length / A.length;
}

function doNowFits(action, doNow) {
  const d = String(doNow || '').toLowerCase();
  const buy = /koop|bijkopen|instap|\bbuy\b|add |go long/.test(d);
  const sell = /verkoop|verklein|\bsell\b|\btrim\b|\bcut\b/.test(d);
  const wait = /wacht|zijlijn|niet (bij)?koop|stand aside|do not buy|don't buy|hold off|houd je/.test(d);
  if (action === 'BUY') return buy && !wait;
  if (action === 'SELL') return sell;
  return !buy;
}

function polishDecision(decision, ctx, lang) {
  const fix = s => (lang === 'nl' ? cleanupDutch(s) : String(s || '').trim());
  let thesis = fix(String(decision.thesis || '')
    .replace(/\s*de quant score[^.]*\.\s*/ig, ' ')
    .replace(/\s*quant score[^.]*\.\s*/ig, ' '));
  if (!thesis || isVague(thesis) || JARGON_RE.test(thesis) || (lang === 'nl' && looksBrokenDutch(thesis))) {
    thesis = factThesis(ctx, decision.action, lang);
  }

  const why = (decision.why || [])
    .map(s => fix(s))
    .filter(s => s && !isVague(s) && !JARGON_RE.test(s) && !looksBrokenDutch(s) && wordOverlap(s, thesis) < 0.7);
  const risks = (decision.risks || [])
    .map(s => fix(s))
    .filter(s => s && !isVague(s) && !JARGON_RE.test(s) && !(lang === 'nl' && looksBrokenDutch(s)));

  let doNow = fix(decision.doNow);
  if (!doNowFits(decision.action, doNow) || isVague(doNow) || JARGON_RE.test(doNow)) {
    doNow = fallbackDoNow(decision.action, ctx, lang);
  }

  return {
    ...decision,
    thesis: thesis.slice(0, 400),
    doNow: doNow.slice(0, 180),
    why: (why.length ? why : factWhy(ctx, lang)).slice(0, 5),
    risks: (risks.length ? risks : factRisks(ctx, decision.action, lang)).slice(0, 4)
  };
}

function qualityRewritePrompt(decision, ctx, lang) {
  const json = JSON.stringify({
    action: decision.action,
    conviction: decision.conviction,
    thesis: decision.thesis,
    doNow: decision.doNow,
    why: decision.why,
    risks: decision.risks,
    catalysts: decision.catalysts,
    disagreement: decision.disagreement
  });
  const extra = `PRICE ${ctx.price} SUPPORT ${ctx.support ?? 'n/a'} RESISTANCE ${ctx.resistance ?? 'n/a'} DAY ${ctx.dayChange ?? 'n/a'} HEADLINE: ${firstHeadline(ctx) || '(none)'}`;
  if (lang === 'nl') {
    return `Dit antwoord is te vaag of spreekt zichzelf tegen. Herschrijf de JSON.
Houd action, conviction en disagreement hetzelfde.
thesis moet een niveau of nieuwsfeit noemen. doNow moet bij action horen.
why mag de thesis niet herhalen. risks mag niet "de prijs kan dalen" zijn.
Geen RSI/MACD. Alleen Nederlands. Alleen JSON.

Data: ${extra}

${json}`;
  }
  return `This answer is too vague or contradicts itself. Rewrite the JSON.
Keep action, conviction and disagreement the same.
thesis must name a level or a news fact. doNow must match action.
why must not repeat the thesis. risks must not be "the price can fall".
No RSI/MACD. English only. JSON only.

Data: ${extra}

${json}`;
}

function needsQualityRewrite(raw) {
  const blob = readableBlob(raw);
  return isVague(raw.thesis) || JARGON_RE.test(raw.thesis) || !doNowFits(raw.action, raw.doNow)
    || (raw.why || []).some(isVague) || (raw.risks || []).some(isVague) || blob.length < 40;
}

function rewritePrompt(decision, lang) {
  const json = JSON.stringify({
    action: decision.action,
    conviction: decision.conviction,
    thesis: decision.thesis,
    doNow: decision.doNow,
    why: decision.why,
    risks: decision.risks,
    catalysts: decision.catalysts,
    disagreement: decision.disagreement
  });
  if (lang === 'nl') {
    return `Herschrijf onderstaande JSON. Houd action, conviction en disagreement exact hetzelfde.
Zet thesis, doNow, why, risks en catalysts om naar natuurlijk Nederlands. Geen Engels meer.
Geef alleen de JSON.

${json}`;
  }
  return `Rewrite the JSON below. Keep action, conviction and disagreement exactly the same.
Put thesis, doNow, why, risks and catalysts into natural English. No Dutch.
Return JSON only.

${json}`;
}

function normalizeDecision(raw, fallbackAction = 'HOLD') {
  const action = String(raw?.action || fallbackAction).toUpperCase();
  const disagreement = String(raw?.disagreement || 'none').toLowerCase();
  return {
    action: action === 'BUY' || action === 'SELL' ? action : 'HOLD',
    conviction: Math.max(0, Math.min(100, Number(raw?.conviction) || 0)),
    thesis: String(raw?.thesis || '').trim().slice(0, 400),
    doNow: String(raw?.doNow || '').trim().slice(0, 180),
    why: Array.isArray(raw?.why) ? raw.why.map(s => String(s).trim()).filter(Boolean).slice(0, 5) : [],
    risks: Array.isArray(raw?.risks) ? raw.risks.map(s => String(s).trim()).filter(Boolean).slice(0, 4) : [],
    catalysts: Array.isArray(raw?.catalysts) ? raw.catalysts.map(s => String(s).trim()).filter(Boolean).slice(0, 3) : [],
    disagreement: disagreement === 'news_vs_tech' ? 'news_vs_tech' : 'none',
    model: activeModel
  };
}

function parseJsonContent(text) {
  try { return JSON.parse(text || '{}'); } catch {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

async function chatJson(messages, opts = {}) {
  await ensureModel();
  const res = await axios.post(`${HOST}/api/chat`, {
    model: activeModel,
    stream: false,
    format: 'json',
    options: { temperature: opts.temperature ?? 0.28, num_predict: opts.numPredict ?? 480 },
    messages
  }, { timeout: opts.timeout ?? TIMEOUT });
  return parseJsonContent(res.data?.message?.content || '{}');
}

function articleLines(items) {
  return items.map((a, i) => {
    const raw = String(a.text || a.summary || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const body = isUsefulText(raw, a.title) ? raw : '';
    return `${i + 1}. TITLE: ${a.title}${a.source ? ` (${a.source})` : ''}\nARTICLE TEXT:\n${body || '(no article text fetched)'}`;
  }).join('\n\n');
}

function inventedNumbers(blurb, text) {
  const nums = String(blurb).match(/\d+(?:[.,]\d+)?/g) || [];
  if (!nums.length) return false;
  const corpus = String(text);
  return nums.some(n => {
    const variants = [n, n.replace(',', '.'), n.replace('.', ',')];
    return !variants.some(v => corpus.includes(v));
  });
}

function contradictsSource(blurb, source) {
  const b = String(blurb).toLowerCase();
  const s = String(source).toLowerCase();
  const pairs = [
    [/\b(lower|cut|trim|reduce|slash|downgrade)s?\b/, /\b(verhoog|raised?|hike|boost|upgrade)/],
    [/\b(raise|hike|boost|upgrade|increas)\w*\b/, /\b(verlaag|lower|cut|trim|downgrade)/],
    [/\b(sell|underperform|strong sell)\b/, /\b(koop|strong buy|outperform)\b/],
    [/\b(strong buy|outperform|overweight)\b/, /\b(verkoop|underperform)\b/]
  ];
  return pairs.some(([srcRe, badRe]) => srcRe.test(s) && badRe.test(b) && !srcRe.test(b));
}

function dropsAllNumbers(blurb, source) {
  const nums = (String(source).match(/\d+(?:[.,]\d+)?/g) || [])
    .filter(n => Number(String(n).replace(',', '.')) >= 5);
  if (nums.length < 2) return false;
  return !nums.some(n => {
    const variants = [n, n.replace(',', '.'), n.replace('.', ',')];
    return variants.some(v => String(blurb).includes(v));
  });
}

function snippetFrom(item) {
  const t = String(item.text || item.summary || '').replace(/\s+/g, ' ').trim();
  if (!isUsefulText(t, item.title) || /comprehensive up-to-date news coverage/i.test(t)) return '';
  const sentences = t.match(/[^.!?]+[.!?]+/g);
  if (!sentences?.length) return t.length <= 420 ? t : '';
  let out = '';
  for (const s of sentences) {
    const next = `${out} ${s}`.trim();
    if (out && next.length > 420) break;
    out = next;
    if (out.length >= 180) break;
  }
  return out || sentences[0].trim();
}

function polishSummary(raw, item, lang) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\$(\d+)\.\s+(\d)/g, '$$$1.$2').replace(/(\d+)\.\s+(\d+)\s+(miljoen|miljard|billion|million)/gi, '$1.$2 $3');
  if (lang === 'nl') s = s.replace(/\b(\d+)\.(\d+)%/g, '$1,$2%');
  if (/comprehensive up-to-date news coverage|aggregated from sources all over the world|join (us|developers|researchers)|register (now|for)|registration is open|#1 ai conference|hands-on workshops|gtc berlin/i.test(s)) s = '';
  const sourceText = `${item.text || item.summary || ''}`;
  const thin = s.length < 50 || (/\?$/.test(s) && s.length < 90) || wordOverlap(s, item.title) > 0.65;
  if (!sourceText || sourceText.length < 40) return '';
  if (/join (us|developers|researchers)|register (now|for)|registration is open|#1 ai conference|hands-on workshops|gtc berlin/i.test(sourceText)) return '';
  if (!s || thin || inventedNumbers(s, sourceText) || contradictsSource(s, sourceText) || dropsAllNumbers(s, sourceText)) {
    s = snippetFrom(item);
  }
  if (s && !/[.!?]$/.test(s)) {
    const cut = s.match(/^[\s\S]+[.!?]/);
    s = cut ? cut[0].trim() : s;
  }
  const parts = s.match(/[^.!?]+[.!?]+/g);
  if (parts?.length > 1 && (parts[parts.length - 1].trim().length < 28 || /\$\d+\.$/.test(parts[parts.length - 1]))) {
    s = parts.slice(0, -1).join(' ').trim();
  }
  return s;
}

function polishDigest(raw, items, lang) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\$(\d+)\.\s+(\d)/g, '$$$1.$2').replace(/(\d+)\.\s+(\d+)\s+(miljoen|miljard|billion|million)/gi, '$1.$2 $3');
  if (lang === 'nl') s = s.replace(/\b(\d+)\.(\d+)%/g, '$1,$2%');
  const corpus = items.map(i => i.text || i.summary || '').join(' ');
  if (corpus.length < 40) return '';
  const useful = items.filter(i => isUsefulText(i.text || i.summary || '', i.title));
  if (!s || /register (now|for)|gtc berlin|hands-on workshops|over 100 sessions/i.test(s) || inventedNumbers(s, corpus) || contradictsSource(s, corpus) || wordOverlap(s, items.map(i => i.title).join(' ')) > 0.7) {
    s = useful.map(i => snippetFrom(i)).filter(Boolean).slice(0, 2).join(' ');
  }
  const sentences = s.match(/[^.!?]+[.!?]+/g);
  if (!sentences?.length) return s.length <= 420 ? s : '';
  return sentences.slice(0, 3).join(' ').trim();
}

export async function summarizeArticles(items, lang = 'en') {
  const locale = normalizeLang(lang);
  const list = (items || []).filter(a => a?.title);
  if (!list.length) return [];

  const system = locale === 'nl'
    ? `Je geeft alleen geldige JSON. Geen markdown. Geen verzonnen feiten.
TAAL: Nederlands. Elke samenvatting is 100% Nederlands, ook als het artikel Engels is.
Cijfers met komma (1,32%).`
    : `You output only valid JSON. No markdown. No invented facts.
LANGUAGE: English. Each summary is 100% English.`;

  const prompt = locale === 'nl'
    ? `Je krijgt de ARTIKELTEKST van elke bron (niet alleen de kop).
Per bron: 1 of 2 VOLLEDIGE zinnen met alleen kernfeiten (wie, wat, welk cijfer). Nooit afkappen.
Daarnaast DIGEST: 2 korte zinnen die de beleggersfeiten uit álle artikelen combineren. Geen event-uitnodigingen of promo.
Niet de kop herhalen. Geen vage vraag. Niet omdraaien: lowers = verlaagt, raise = verhoogt.
Gebruik ALLEEN de artikeltekst. Verzin niets. Event-landingpages zonder nieuws: samenvatting leeg.
Als er geen artikeltekst is, laat die samenvatting leeg.

ARTIKELEN:
${articleLines(list)}

Geef alleen JSON, evenveel summaries als artikelen, zelfde volgorde:
{"digest":"...","summaries":["...","..."]}`
    : `You get the ARTICLE TEXT of each source (not just the headline).
Per source: 1 or 2 COMPLETE sentences with only the key facts (who, what, which number). Never truncate.
Also DIGEST: 2 short sentences combining the investor facts from all articles. Skip event invites and promo pages.
Do not restate the headline. No vague question. Do not flip meaning: lowers ≠ raises.
Use ONLY the article text. Invent nothing. Event landing pages with no news: empty summary.
If there is no article text, leave that summary empty.

ARTICLES:
${articleLines(list)}

JSON only, same count and order:
{"digest":"...","summaries":["...","..."]}`;

  let summaries = [];
  let digest = '';
  try {
    const raw = await chatJson([
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ], { numPredict: 900, temperature: 0.2 });
    summaries = Array.isArray(raw?.summaries) ? raw.summaries : [];
    digest = String(raw?.digest || '');
    const blob = `${digest} ${summaries.join(' ')}`;
    if (blob.trim().length > 20 && !textMatchesLang(blob, locale)) {
      const rewritten = await chatJson([
        { role: 'system', content: system },
        { role: 'user', content: locale === 'nl'
          ? `Zet digest en elke samenvatting om naar natuurlijk Nederlands. Houd de feiten. Geen Engels. Alleen JSON.\n${JSON.stringify({ digest, summaries })}`
          : `Rewrite digest and each summary in natural English. Keep the facts. No Dutch. JSON only.\n${JSON.stringify({ digest, summaries })}` }
      ], { numPredict: 900, temperature: 0.15 });
      if (Array.isArray(rewritten?.summaries)) summaries = rewritten.summaries;
      if (rewritten?.digest) digest = String(rewritten.digest);
    }
  } catch {
    return { summaries: list.map(() => ''), digest: '' };
  }

  return {
    summaries: list.map((item, i) => polishSummary(summaries[i], item, locale)),
    digest: polishDigest(digest, list, locale)
  };
}

export async function decideTrade(ctx) {
  const lang = normalizeLang(ctx.lang);
  const fallback = ctx.fiveDay?.prediction === 'UP' ? 'BUY' : ctx.fiveDay?.prediction === 'DOWN' ? 'SELL' : 'HOLD';
  const system = systemPrompt(lang);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: buildPrompt(ctx, lang) }
  ];
  let firstRaw = await chatJson(messages);
  if (process.env.OLLAMA_DEBUG) console.error('ollama first', lang, firstRaw);
  let first = normalizeDecision(firstRaw, fallback);
  if (!readableBlob(first)) {
    firstRaw = await chatJson(messages);
    first = normalizeDecision(firstRaw, fallback);
  }

  let decision = first;
  if (readableBlob(first) && !textMatchesLang(readableBlob(first), lang)) {
    const rewritten = normalizeDecision(await chatJson([
      { role: 'system', content: system },
      { role: 'user', content: rewritePrompt(first, lang) }
    ]), first.action);
    rewritten.action = first.action;
    rewritten.conviction = first.conviction;
    rewritten.disagreement = first.disagreement;
    if (decisionMatchesLang(rewritten, lang)) decision = rewritten;
  }

  if (needsQualityRewrite(decision)) {
    const tighter = normalizeDecision(await chatJson([
      { role: 'system', content: system },
      { role: 'user', content: qualityRewritePrompt(decision, ctx, lang) }
    ]), decision.action);
    tighter.action = decision.action;
    tighter.conviction = decision.conviction;
    tighter.disagreement = decision.disagreement;
    if (readableBlob(tighter)) decision = tighter;
  }

  return { ...polishDecision(decision, ctx, lang), lang };
}
