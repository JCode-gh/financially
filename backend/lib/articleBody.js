import axios from 'axios';
import { decodeEntities } from './articles.js';
import { isGoogleNewsArticle, resolveGoogleNewsUrl } from './googleNewsUrl.js';
import { detectEvents } from '../models/sentimentAnalyzer.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_MS = 7000;
const BODY_CAP = 2400;
const SKIP_HOST = /consent\.google\.com|finnhub\.io$/i;
const BOILER = /comprehensive up-to-date news coverage|aggregated from sources all over the world by google news/i;
const JUNK = /cookie|subscribe|newsletter|sign up|advertisement|consent|see the full list for free|we.ve found \d+ .*(stocks|shares)|attractive valuations|not want to miss this free list|create an account|enable javascript|privacykeuzes|privacyinstellingen|jouw privacy|manage privacy settings|please wait|just a moment|join (us|developers|researchers|sessions)|roll up your sleeves|register (now|for)|registration is open|#1 ai conference|hands-on workshops|gtc berlin|over 100 sessions|inspire your life.?s work|gtc delivers the tools|passes start|secure yours|sells out|pregame show|save (your |the )?(seat|spot)|early.?bird|tickets? (are )?on sale|opens in a new window|must-have earbuds|on sale for \$/i;

function stripTags(html) {
  return decodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const reFlip = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`,
      'i'
    );
    const m = html.match(re) || html.match(reFlip);
    if (m?.[1]) {
      const text = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
      if (text.length >= 40 && !BOILER.test(text) && !JUNK.test(text)) return text;
    }
  }
  return '';
}

function collectParagraphs(html) {
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(html)) && paras.join(' ').length < BODY_CAP) {
    const t = stripTags(m[1]);
    if (t.length >= 60 && !JUNK.test(t) && !BOILER.test(t)) paras.push(t);
  }
  return paras;
}

function flattenLd(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flattenLd);
  const out = [data];
  if (data['@graph']) out.push(...flattenLd(data['@graph']));
  return out;
}

function jsonLdArticle(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let best = '';
  let m;
  while ((m = re.exec(html))) {
    try {
      const nodes = flattenLd(JSON.parse(m[1]));
      for (const n of nodes) {
        const body = typeof n.articleBody === 'string' ? n.articleBody
          : (typeof n.text === 'string' && /article/i.test(String(n['@type'] || '')) ? n.text : '');
        const clean = stripTags(body);
        if (clean.length > best.length && !JUNK.test(clean)) best = clean;
      }
    } catch { /* ignore broken JSON-LD */ }
  }
  return best.slice(0, BODY_CAP);
}

function extractArticleText(html) {
  if (!html || typeof html !== 'string') return '';
  const ld = jsonLdArticle(html);
  const scoped = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i)?.[1]
    || html.match(/class=["'][^"']*(?:caas-body|article__body|article-body|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
    || html;
  const meta = metaContent(html, ['og:description', 'twitter:description', 'description']);
  const paras = collectParagraphs(scoped);
  const fallback = paras.length ? paras : collectParagraphs(html);
  const parts = [];
  if (ld) parts.push(ld);
  else if (meta) parts.push(meta);
  for (const p of fallback) {
    const head = (ld || meta).toLowerCase().slice(0, 40);
    if (head && p.toLowerCase().startsWith(head)) continue;
    parts.push(p);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, BODY_CAP);
}

function isSafeHttpUrl(raw) {
  try {
    const p = new URL(String(raw || '').trim());
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return false;
    const host = p.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === '::1') return false;
    if (/^(127|10|192\.168|169\.254)\./.test(host)) return false;
    if (SKIP_HOST.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function titleKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\bgtc eu\b/g, 'gtc')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 70);
}

export function isUsefulText(text, title = '') {
  const t = decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim();
  if (t.length < 40 || BOILER.test(t) || JUNK.test(t)) return false;
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return false;
  const compact = t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const head = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (head && compact.length <= head.length + 24) return false;
  return true;
}

function clickableUrl(article, corpus) {
  if (article.resolvedUrl && isSafeHttpUrl(article.resolvedUrl) && !isGoogleNewsArticle(article.resolvedUrl)) {
    return article.resolvedUrl;
  }
  const title = article.headline || article.title || '';
  const key = titleKey(title);
  const candidates = [article, ...(corpus || []).filter(a => titleKey(a.headline || a.title) === key)];
  const google = candidates.find(a => isGoogleNewsArticle(a.url || a.link || ''));
  if (google) return google.url || google.link;
  const other = candidates.find(a => {
    const u = a.url || a.link || '';
    return u && isSafeHttpUrl(u) && !/finnhub\.io/i.test(u);
  });
  if (other) return other.url || other.link;
  const raw = article.url || article.link || '';
  if (raw && isSafeHttpUrl(raw) && !/finnhub\.io/i.test(raw) && !isGoogleNewsArticle(raw)) return raw;
  return '';
}

function bestCorpusText(article, corpus) {
  const key = titleKey(article.headline || article.title);
  let best = '';
  for (const a of [article, ...(corpus || [])]) {
    if (key && titleKey(a.headline || a.title) !== key && a !== article) continue;
    const text = decodeEntities(String(a.summary || a.description || a.body || '')).replace(/\s+/g, ' ').trim();
    if (isUsefulText(text, a.headline || a.title) && text.length > best.length) best = text;
  }
  return best;
}

const PROMO_TITLE = /^(gtc\b)|gtc eu|ai conference|registration is open|join (us|developers)|gamescom|hallway conversations|gift guide|on sale for/i;
const WEAK_EVENT = new Set(['product_launch', 'partnership', 'expansion']);

function hasPriceEvent(events) {
  return events.some(e => Math.abs(e.impact) >= 1 && !WEAK_EVENT.has(e.id));
}

export function isPriceMovingArticle(article, ticker = '') {
  const title = article.headline || article.title || '';
  const url = article.url || article.link || article.resolvedUrl || '';
  const blob = `${title} ${article.summary || article.description || article.body || article.text || ''}`;
  const other = title.match(/^['"]?([A-Z]{2,5})\s*:/);
  if (!title || PROMO_TITLE.test(title) || /nvidia\.com\/.*(gtc|events)/i.test(url)) {
    return false;
  }
  if (ticker && other && other[1] !== String(ticker).toUpperCase()) return false;
  if (/\b(yieldmax|covered calls?|high-yield income)\b/i.test(title)) return false;
  const events = detectEvents(blob);
  if (JUNK.test(blob) && !hasPriceEvent(events)) return false;
  return hasPriceEvent(events);
}

function priceMoveRank(article) {
  const blob = `${article.headline || article.title || ''} ${article.summary || article.description || article.body || article.text || ''}`;
  return detectEvents(blob)
    .filter(e => !WEAK_EVENT.has(e.id))
    .reduce((s, e) => s + Math.abs(e.impact), 0);
}

export function pickSourceArticles(articles, ticker = '') {
  const scored = [];
  for (const a of articles || []) {
    const title = a.headline || a.title || '';
    const url = a.url || a.link || '';
    if (!title || !url || !isPriceMovingArticle(a, ticker)) continue;
    scored.push({
      a,
      rank: priceMoveRank(a),
      recency: new Date(a.publishedAt || 0).getTime()
    });
  }
  scored.sort((x, y) => y.rank - x.rank || y.recency - x.recency);
  const seen = new Set();
  const out = [];
  for (const { a } of scored) {
    const k = titleKey(a.headline || a.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
    if (out.length >= 8) break;
  }
  return out;
}

function hasReadableCopy(article) {
  const title = article.headline || article.title || '';
  return isUsefulText(article.body || article.summary || article.description || article.text || '', title);
}

function preferWithBody(items, n = 8, ticker = '') {
  const movers = items.filter(a => isPriceMovingArticle(a, ticker) && hasReadableCopy(a));
  const withBody = movers.filter(a => a.body);
  const without = movers.filter(a => !a.body);
  return [...withBody, ...without].slice(0, n);
}

async function resolveFetchUrl(article, corpus) {
  const key = titleKey(article.headline || article.title);
  const candidates = [article, ...(corpus || []).filter(a => titleKey(a.headline || a.title) === key)];
  for (const a of candidates) {
    const url = a.url || a.link || '';
    if (isGoogleNewsArticle(url)) {
      const resolved = await resolveGoogleNewsUrl(url);
      if (resolved && isSafeHttpUrl(resolved)) return resolved;
    }
  }
  for (const a of candidates) {
    const url = a.url || a.link || '';
    if (url && isSafeHttpUrl(url) && !isGoogleNewsArticle(url) && !/finnhub\.io/i.test(url)) return url;
  }
  return '';
}

export async function fetchArticleBody(url) {
  if (!isSafeHttpUrl(url)) return '';
  try {
    const res = await axios.get(url, {
      timeout: FETCH_MS,
      maxRedirects: 5,
      maxContentLength: 900_000,
      responseType: 'text',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8,nl;q=0.5'
      },
      validateStatus: s => s >= 200 && s < 400
    });
    const text = extractArticleText(res.data);
    return BOILER.test(text) ? '' : text;
  } catch {
    return '';
  }
}

export async function enrichArticles(articles, corpus = articles, ticker = '') {
  const list = (articles || []).slice(0, 8);
  const enriched = await Promise.all(list.map(async (a) => {
    const resolvedUrl = await resolveFetchUrl(a, corpus);
    const fetched = resolvedUrl ? await fetchArticleBody(resolvedUrl) : '';
    const existing = bestCorpusText(a, corpus);
    const title = a.headline || a.title || '';
    const body = isUsefulText(fetched, title)
      ? fetched
      : (isUsefulText(existing, title) ? existing : '');
    return { ...a, body: String(body || '').slice(0, BODY_CAP), resolvedUrl };
  }));
  return preferWithBody(enriched.map(a => ({
    ...a,
    url: clickableUrl(a, corpus)
  })).filter(a => a.url), 8, ticker);
}

export function completeSentences(text, max = 420) {
  const t = decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const sentences = t.match(/[^.!?]+[.!?]+/g);
  if (!sentences?.length) return t.length <= max ? t : '';
  let out = '';
  for (const s of sentences) {
    const next = `${out} ${s}`.trim();
    if (out && next.length > max) break;
    out = next;
    if (out.length >= 180) break;
  }
  return out || sentences[0].trim();
}

export function fallbackSnippet(text, title = '') {
  const t = decodeEntities(String(text || '')).replace(/\s+/g, ' ').trim();
  if (!isUsefulText(t, title)) return '';
  return completeSentences(t);
}
