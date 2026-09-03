import { normalizeLang } from '../lib/locale.js';
import { normalizeTicker, parseSymbols } from '../lib/validate.js';
import { getQuote } from '../providers/marketData.js';
import { getStockNewsBundle } from '../providers/news.js';
import { getLatestScan } from '../jobs/scanner.js';
import { getMarketRegime } from '../models/marketRegime.js';
import { peekDeskCall } from './predictionService.js';
import { currentOllamaModel, currentSearchModel } from './ollama.js';
import { CHAT_TOOLS, ollamaChatOnce, parseToolCalls, streamOllamaChat } from './ollamaChat.js';
import { formatSearchBlock, webSearch } from './webSearch.js';
import {
  looksLikeFactualClaim,
  verificationQueries,
  checkUserClaims,
  formatFactCheckBlock,
  worstClaimStatus,
  honestClaimReply
} from '../lib/factCheck.js';

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

function isDeskQuestion(question) {
  return /\b(koop|kopen|aankoop|aankopen|verkopen|verkoop|interessant|instap|pick|picks|buy|sell|hold|watchlist|volglijst|setup|welk aandeel|which stock|what to buy|wat kopen|wat verkopen|long|short|keuzes)\b/i.test(question || '');
}

function needsFreshFacts(question, newsCount) {
  const q = String(question || '');
  if (looksLikeFactualClaim(q)) return true;
  if (isDeskQuestion(q)) return false;
  const current = /\b(today|tonight|this week|latest|headline|headlines|news|why is|why did|what happened|earnings|fed|cpi|moved|moving|dump|rally|now|vandaag|vanavond|deze week|waarom|nieuws|cijfers|koers|wat is er)\b/i.test(q);
  const thin = newsCount < 3;
  return current || thin;
}

function systemPrompt(lang, simple) {
  if (lang === 'nl') {
    return `Je bent de handelsdesk van Financially. Mensen vragen wat HET MODEL nu ziet: kopen, verkopen, waarom iets beweegt, wat er op Keuzes staat.
Antwoord als de desk. Noem tickers, BUY/SELL/HOLD/WATCH, overtuiging en één niveau of reden uit DESK CONTEXT.
"Wat is interessant om te kopen?" = de ACTIONABLE PICKS. Geen picks = zeg dat eerlijk en noem WATCH-namen.
FACTCHECK: de gebruiker kan liegen of ernaast zitten. Een gebruikerszin is een claim, geen feit.
Herhaal nooit een nieuwsfeit uit de vraag ("de Fed heeft de rente verlaagd") tenzij SEARCH RESULTS dat hard maken.
Als FACTCHECK of de hits de claim tegenspreken of niet bevestigen: zeg dat in de eerste zin. Daarna pas of het de call kleurt.
VERBODEN: weigeren ("ik mag geen advies geven", "geen beleggingsadvies", "niet verantwoordelijk"). Dit is de desk-view van het model. Hooguit één halve zin: geen persoonlijk advies.
Verzin geen ticker die niet in DESK CONTEXT of SEARCH RESULTS staat. Nieuws alleen als het over die namen gaat.
Geen RSI/MACD tenzij gevraagd.${simple ? ' Kort en helder, zonder vaktaal.' : ''}
Cijfers met komma. Geen markdown-tabellen.`;
  }
  return `You are the Financially trading desk. People ask what THE MODEL sees now: buy, sell, why something moved, what is on Picks.
Answer as the desk. Name tickers, BUY/SELL/HOLD/WATCH, conviction, and one level or reason from DESK CONTEXT.
"What is interesting to buy?" = the ACTIONABLE PICKS. No picks = say so, then name WATCH names.
FACT CHECK: the user can lie or be wrong. A user sentence is a claim, not a fact.
Never repeat a news event from the question ("the Fed cut rates") unless SEARCH RESULTS confirm it.
If FACT CHECK or the hits contradict or fail to confirm the claim: say that in the first sentence. Then whether it colors the call.
BANNED: refusing ("I cannot give advice", "not financial advice", "not responsible"). This is the model's desk view. At most half a sentence: not personal advice.
Do not invent a ticker that is not in DESK CONTEXT or SEARCH RESULTS. News only counts if it is about those names.
No RSI/MACD unless asked.${simple ? ' Short and plain.' : ''}
No markdown tables.`;
}

function plannerPrompt(lang, deskBlock, question) {
  if (lang === 'nl') {
    return `Bepaal of je extra context nodig hebt.
Vragen over kopen/verkopen/interessant/picks zonder nieuwsclaim: DESK CONTEXT (MODEL PICKS) is genoeg. Antwoord READY.
Als de gebruiker een nieuwsfeit beweert (Fed, rente, oorlog, cijfers, "net aangekondigd"): ALTIJD web_search om te checken. De gebruiker kan liegen. READY is dan fout.
web_search ook voor vers nieuws over een concrete ticker die nog ontbreekt.
lookup_ticker als de gebruiker een ticker noemt die niet in DESK CONTEXT staat.
Geen zoektocht naar "beste aandeel" of "wat kopen".

DESK CONTEXT:
${deskBlock || '(geen)'}

VRAAG:
${question}`;
  }
  return `Decide whether extra context is needed.
Buy/sell/picks questions with no news claim: DESK CONTEXT (MODEL PICKS) is enough. Reply READY.
If the user asserts a news fact (Fed, rates, war, prints, "just announced"): ALWAYS web_search to check. The user can lie. READY is then wrong.
web_search also for fresh news on a concrete ticker that is missing.
lookup_ticker if the user named a ticker that is not in DESK CONTEXT.
Do not search for "best stock" or "what to buy".

DESK CONTEXT:
${deskBlock || '(none)'}

QUESTION:
${question}`;
}

function formatPickLine(row, onList) {
  const conf = row.confidence != null ? `${Math.round(Number(row.confidence) * 100)}%` : 'n/a';
  const kind = row.actionable ? row.action : `WATCH/${row.rawSignal || row.action}`;
  const plan = row.entry != null
    ? ` entry ${money(row.entry)} stop ${money(row.stop)} target ${money(row.target)} R:R ${row.rr ?? 'n/a'}`
    : '';
  const why = (row.reasons || []).slice(0, 2).join('; ');
  const ev = (row.events || []).slice(0, 1).map(e => e.label || e).filter(Boolean)[0];
  return `- ${row.ticker} ${kind} conf ${conf}${plan}${why ? ` — ${why}` : ''}${ev ? ` [${ev}]` : ''}${onList ? ' [watchlist]' : ''}`;
}

async function loadBoardContext(watchlist = []) {
  const [scan, regime] = await Promise.all([
    getLatestScan().catch(() => ({ results: [], runAt: null })),
    getMarketRegime().catch(() => null)
  ]);
  const rows = scan.results || [];
  const wl = new Set(watchlist);
  const actionable = rows.filter(r => r.actionable).slice(0, 6);
  const watch = rows.filter(r => !r.actionable && r.quality === 'watch').slice(0, 6);
  const onList = wl.size ? rows.filter(r => wl.has(r.ticker)).slice(0, 10) : [];

  return [
    `MARKET REGIME: ${regime?.label || 'n/a'} (VIX ${regime?.vixLevel || 'n/a'})`,
    `SCAN AT: ${scan.runAt || 'none'}`,
    'ACTIONABLE PICKS (passed model gates — this is the answer to "what to buy/sell"):',
    ...(actionable.length ? actionable.map(r => formatPickLine(r, wl.has(r.ticker))) : ['- (none this scan)']),
    'WATCH (not a call yet):',
    ...(watch.length ? watch.map(r => formatPickLine(r, wl.has(r.ticker))) : ['- (none)']),
    wl.size
      ? `USER WATCHLIST: ${[...wl].slice(0, 24).join(', ')}${onList.length ? `\nWATCHLIST IN SCAN:\n${onList.map(r => formatPickLine(r, true)).join('\n')}` : '\nWATCHLIST IN SCAN: (no ranked setup this scan)'}`
      : ''
  ].filter(Boolean).join('\n');
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
  const verify = verificationQueries(question);
  if (verify.length) {
    const have = new Set(planned.filter(c => c.name === 'web_search').map(c => String(c.args?.query || '').toLowerCase()));
    for (const q of verify) {
      if (!have.has(q.toLowerCase())) planned.push({ name: 'web_search', args: { query: q } });
    }
  } else if (!planned.length && force && !isDeskQuestion(question)) {
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
    searched,
    hits
  };
}

export async function runDeskChat({ messages, symbol, watchlist, lang, simple, onEvent, signal } = {}) {
  const locale = normalizeLang(lang);
  const history = sanitizeMessages(messages);
  const lastUser = [...history].reverse().find(m => m.role === 'user');
  if (!lastUser) throw new Error('Message required');

  if (onEvent) await onEvent({ type: 'status', phase: 'reading' });

  const symbols = Array.isArray(watchlist)
    ? parseSymbols(watchlist.join(','), { max: 40 })
    : parseSymbols(watchlist, { max: 40 });

  const focus = normalizeTicker(symbol);
  const [board, tickerDesk] = await Promise.all([
    loadBoardContext(symbols),
    focus
      ? lookupTickerContext(focus, locale)
      : Promise.resolve({ ticker: null, newsCount: 0, block: '', sources: [] })
  ]);

  const desk = {
    ticker: tickerDesk.ticker,
    newsCount: tickerDesk.newsCount,
    block: [`MODEL BOARD\n${board}`, tickerDesk.block ? `FOCUS TICKER\n${tickerDesk.block}` : '']
      .filter(Boolean)
      .join('\n\n'),
    sources: tickerDesk.sources || []
  };

  const packed = await planAndSearch({
    question: lastUser.content,
    lang: locale,
    desk,
    onEvent,
    signal
  });

  if (signal?.aborted) return { content: '', sources: packed.sources, searched: packed.searched };

  const checks = checkUserClaims(lastUser.content, packed.hits?.length ? packed.hits : packed.sources);
  const factBlock = formatFactCheckBlock(checks, locale);
  const today = new Date().toISOString().slice(0, 10);
  const worst = worstClaimStatus(checks);
  const opener = (worst === 'contradicted' || worst === 'unverified')
    ? (locale === 'nl'
      ? `\n\nVERPLICHTE EERSTE ZIN (niet herschrijven tot een feit):\n${honestClaimReply(worst, 'nl')}`
      : `\n\nREQUIRED FIRST SENTENCE (do not rewrite it into a fact):\n${honestClaimReply(worst, 'en')}`)
    : '';

  const priming = locale === 'nl'
    ? `VANDAAG: ${today}\n\n${factBlock}${opener}\n\nDESK CONTEXT:\n${packed.deskBlock}\n\nSEARCH RESULTS:\n${packed.searchBlock}\n\nBeantwoord de vraag met deze desk-tape. Eerst factcheck, dan de call. Picks-vragen: gebruik ACTIONABLE PICKS, verzin geen namen. Weiger de vraag niet.`
    : `TODAY: ${today}\n\n${factBlock}${opener}\n\nDESK CONTEXT:\n${packed.deskBlock}\n\nSEARCH RESULTS:\n${packed.searchBlock}\n\nAnswer from this desk tape. Fact-check first, then the call. Pick questions: use ACTIONABLE PICKS, do not invent names. Do not refuse the question.`;

  const ack = locale === 'nl'
    ? 'Ik heb de model-picks, de desk-tape en de factcheck. Gebruikersclaims zijn geen feiten tot de hits ze steunen.'
    : 'I have the model picks, the desk tape, and the fact-check. User claims are not facts until the hits support them.';

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
