import { normalizeLang } from '../lib/locale.js';
import { normalizeTicker } from '../lib/validate.js';
import { getQuote } from '../providers/marketData.js';
import { getStockNewsBundle } from '../providers/news.js';
import { peekDeskCall } from './predictionService.js';
import { currentOllamaModel, currentSearchModel } from './ollama.js';
import { CHAT_TOOLS, ollamaChatOnce, parseToolCalls, streamOllamaChat } from './ollamaChat.js';
import { formatSearchBlock, webSearch } from './webSearch.js';

const MAX_MESSAGES = 16;
const MAX_CHARS = 4000;

export function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(m => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content || '').trim().slice(0, MAX_CHARS)
    }))
    .filter(m => m.content)
    .slice(-MAX_MESSAGES);
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return 'n/a';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function needsFreshFacts(question, newsCount) {
  const q = String(question || '');
  const current = /\b(today|tonight|this week|latest|headline|headlines|news|why is|why did|what happened|earnings|fed|cpi|moved|moving|dump|rally|now|vandaag|vanavond|deze week|waarom|nieuws|cijfers|koers|wat is er)\b/i.test(q);
  const thin = newsCount < 3;
  return current || thin;
}

function systemPrompt(lang, simple) {
  if (lang === 'nl') {
    return `Je bent de analist van de handelsdesk van Financially. Je beantwoordt vragen van een belegger.
TAAL: 100% Nederlands. Geen Engels, ook niet als bronnen Engels zijn.
Verzin geen koersen, data, cijfers of nieuws. Gebruik alleen DESK CONTEXT en SEARCH RESULTS.
Als iets ontbreekt, zeg dat eerlijk. Verwijs naar bronnen als je nieuws gebruikt.
Geen RSI/MACD-jargon tenzij de gebruiker erom vraagt.${simple ? ' Schrijf kort en helder, zonder vaktaal.' : ''}
Cijfers met komma (1,32%). Geen markdown-tabellen. Korte alinea's.
Dit is geen persoonlijk beleggingsadvies — wees feitelijk, geen koopdruk.`;
  }
  return `You are the trading-desk analyst for Financially. You answer an investor's questions.
LANGUAGE: 100% English. No Dutch.
Do not invent prices, dates, figures, or headlines. Use only DESK CONTEXT and SEARCH RESULTS.
If something is missing, say so. Cite sources when you use news.
No RSI/MACD jargon unless the user asks.${simple ? ' Keep it short and plain.' : ''}
No markdown tables. Short paragraphs.
This is not personal investment advice — stay factual, no sales pitch.`;
}

function plannerPrompt(lang, deskBlock, question) {
  if (lang === 'nl') {
    return `Bepaal of je extra context nodig hebt. Roep tools aan als het over actueel nieuws, een koersbeweging of een feit gaat dat niet in DESK CONTEXT staat.
web_search: actueel nieuws of feiten die ontbreken.
lookup_ticker: een ticker die de gebruiker noemt en die nog niet (volledig) in DESK CONTEXT staat.
Als DESK CONTEXT genoeg is, antwoord alleen READY.

DESK CONTEXT:
${deskBlock || '(geen)'}

VRAAG:
${question}`;
  }
  return `Decide whether extra context is needed. Call tools for current news, a price move, or a fact missing from DESK CONTEXT.
web_search: current news or missing facts.
lookup_ticker: a ticker the user named that is not already fully in DESK CONTEXT.
If DESK CONTEXT is enough, reply READY only.

DESK CONTEXT:
${deskBlock || '(none)'}

QUESTION:
${question}`;
}

function formatHeadlines(articles, limit = 8) {
  return (articles || []).slice(0, limit).map((a, i) => {
    const extra = a.summary ? ` — ${String(a.summary).slice(0, 160)}` : '';
    return `${i + 1}. ${a.headline}${extra}${a.source ? ` (${a.source})` : ''}`;
  }).join('\n');
}

export async function lookupTickerContext(symbol, lang = 'en') {
  const ticker = normalizeTicker(symbol);
  if (!ticker) return { ticker: null, newsCount: 0, block: '', sources: [] };

  const quote = await getQuote(ticker).catch(() => null);
  const news = await getStockNewsBundle(ticker, quote?.name).catch(() => ({ articles: [], count: 0 }));
  const desk = peekDeskCall(ticker, lang);
  const articles = news.articles || [];
  const ai = desk?.ai;
  const five = desk?.predictions?.find(p => p.horizon === '5d');

  const day = quote?.changePct == null
    ? 'n/a'
    : `${quote.changePct >= 0 ? '+' : ''}${Number(quote.changePct).toFixed(2)}%`;

  const lines = [
    `TICKER: ${ticker}${quote?.name ? ` (${quote.name})` : ''}`,
    `PRICE: ${money(quote?.price)}  DAY: ${day}`,
    desk?.trend?.label ? `TREND: ${desk.trend.label}` : '',
    desk?.indicators?.support != null || desk?.indicators?.resistance != null
      ? `SUPPORT: ${money(desk.indicators.support)}  RESISTANCE: ${money(desk.indicators.resistance)}`
      : '',
    news.stockSentiment
      ? `NEWS: ${news.stockSentiment.label || 'neutral'} (${news.stockSentiment.score ?? 0}) · ${news.count || 0} headlines`
      : `NEWS: ${news.count || 0} headlines`,
    ai ? `DESK CALL: ${ai.action} (${ai.conviction}%) — ${ai.thesis || ''}` : '',
    ai?.doNow ? `DO NOW: ${ai.doNow}` : '',
    five?.prediction ? `QUANT 5D: ${five.prediction}` : '',
    'HEADLINES:',
    formatHeadlines(articles) || '(none that name this ticker)'
  ].filter(Boolean);

  const sources = articles.slice(0, 6).map(a => ({
    title: a.headline,
    url: a.url || '',
    summary: String(a.summary || '').slice(0, 180),
    source: a.source || ''
  })).filter(s => s.title);

  return {
    ticker,
    newsCount: news.count || articles.length,
    block: lines.join('\n'),
    sources
  };
}

async function planAndSearch({ question, lang, desk, onEvent, signal }) {
  const sources = [...(desk.sources || [])];
  const hits = [];
  let searched = false;

  const plannerSystem = lang === 'nl'
    ? 'Je kiest tools. Geen uitleg. Geen markdown. Tool-aanroepen of het woord READY.'
    : 'You pick tools. No explanation. No markdown. Tool calls or the word READY.';

  let planned = [];
  try {
    if (onEvent) await onEvent({ type: 'status', phase: 'searching' });
    const message = await ollamaChatOnce([
      { role: 'system', content: plannerSystem },
      { role: 'user', content: plannerPrompt(lang, desk.block, question) }
    ], {
      model: currentSearchModel(),
      tools: CHAT_TOOLS,
      temperature: 0.1,
      numPredict: 280,
      timeout: 45_000
    });
    planned = parseToolCalls(message);
  } catch {
    planned = [];
  }

  const force = needsFreshFacts(question, desk.newsCount);
  if (!planned.length && force) {
    planned = [{ name: 'web_search', args: { query: question } }];
  }

  for (const call of planned.slice(0, 3)) {
    if (signal?.aborted) break;
    if (call.name === 'web_search') {
      const q = String(call.args?.query || question).slice(0, 180);
      if (onEvent) await onEvent({ type: 'status', phase: 'searching', query: q });
      const found = await webSearch(q, { lang, maxResults: 6 }).catch(() => []);
      hits.push(...found);
      searched = true;
    } else if (call.name === 'lookup_ticker') {
      const extra = await lookupTickerContext(call.args?.symbol, lang);
      if (extra.ticker && extra.ticker !== desk.ticker) {
        desk.block = `${desk.block}\n\n---\n${extra.block}`.trim();
        sources.push(...extra.sources);
      }
    }
  }

  sources.push(...hits.map(h => ({
    title: h.title,
    url: h.url,
    summary: h.content,
    source: h.source
  })));

  const seen = new Set();
  const unique = [];
  for (const s of sources) {
    const key = (s.url || s.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  return {
    deskBlock: desk.block,
    searchBlock: formatSearchBlock(hits),
    sources: unique.slice(0, 10),
    searched
  };
}

export async function runDeskChat({ messages, symbol, lang, simple, onEvent, signal } = {}) {
  const locale = normalizeLang(lang);
  const history = sanitizeMessages(messages);
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  if (!lastUser) throw new Error('Message required');

  if (onEvent) await onEvent({ type: 'status', phase: 'reading' });

  const focus = normalizeTicker(symbol);
  const desk = focus
    ? await lookupTickerContext(focus, locale)
    : { ticker: null, newsCount: 0, block: '', sources: [] };

  const packed = await planAndSearch({
    question: lastUser.content,
    lang: locale,
    desk,
    onEvent,
    signal
  });

  if (signal?.aborted) return { content: '', sources: packed.sources, searched: packed.searched };

  const priming = locale === 'nl'
    ? `DESK CONTEXT:\n${packed.deskBlock || '(geen ticker geladen)'}\n\nSEARCH RESULTS:\n${packed.searchBlock}\n\nGebruik alleen deze feiten. Zeg het als de feed dun is.`
    : `DESK CONTEXT:\n${packed.deskBlock || '(no ticker loaded)'}\n\nSEARCH RESULTS:\n${packed.searchBlock}\n\nUse only these facts. Say so if the feed is thin.`;

  const ack = locale === 'nl'
    ? 'Ik heb de desk-tape en de zoeknotities. Ik verzin niets.'
    : 'I have the desk tape and the search notes. I will not invent facts.';

  if (onEvent) await onEvent({ type: 'status', phase: 'answering' });

  let content = await streamOllamaChat([
    { role: 'system', content: systemPrompt(locale, !!simple) },
    { role: 'user', content: priming },
    { role: 'assistant', content: ack },
    ...history
  ], {
    model: currentOllamaModel(),
    onToken: async (text) => {
      if (onEvent) await onEvent({ type: 'token', text });
    },
    signal
  });

  if (!String(content || '').trim() && !signal?.aborted) {
    content = locale === 'nl'
      ? 'Ik heb geen antwoord kunnen vormen. Probeer de vraag korter of concreter.'
      : 'I could not form an answer. Try a shorter or more specific question.';
    if (onEvent) await onEvent({ type: 'token', text: content });
  }

  return {
    content,
    sources: packed.sources,
    searched: packed.searched,
    model: currentOllamaModel(),
    searchModel: currentSearchModel()
  };
}
