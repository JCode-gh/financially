// Keyless RSS news. US wires plus Google News (localized) so EU/BE tickers
// still get headlines when Finnhub/Yahoo have no coverage.

import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import { companySearchTerms } from '../lib/articles.js';
import { isInternationalTicker, newsLocalesForSymbol } from './symbolFormat.js';

const execAsync = promisify(exec);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MARKET_FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', source: 'MarketWatch' },
  { url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Earnings' },
  { url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=nl&gl=BE&ceid=BE:nl', source: 'Google BE' },
  { url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=nl&gl=NL&ceid=NL:nl', source: 'Google NL' },
  { url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=fr&gl=FR&ceid=FR:fr', source: 'Google FR' },
  { url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=de&gl=DE&ceid=DE:de', source: 'Google DE' },
  { url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en&gl=GB&ceid=GB:en', source: 'Google UK' }
];

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => {
    if (data?.length) cache.set(key, { data, ts: Date.now() });
    return data;
  }).catch(() => {
    const stale = cache.get(key);
    return stale ? stale.data : [];
  });
}

function decode(str) {
  return (str || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function splitGoogleTitle(headline, fallbackSource) {
  const raw = headline || '';
  const cut = raw.lastIndexOf(' - ');
  if (cut > 8 && cut < raw.length - 3) {
    return { headline: raw.slice(0, cut).trim(), source: raw.slice(cut + 3).trim() || fallbackSource };
  }
  return { headline: raw, source: fallbackSource };
}

function parseRss(xml, sourceName) {
  const items = [];
  const matches = String(xml).match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of matches.slice(0, 40)) {
    const rawTitle = tag(block, 'title');
    if (!rawTitle || /google (news|nieuws)/i.test(rawTitle)) continue;
    const { headline, source } = splitGoogleTitle(rawTitle, sourceName);
    if (!headline) continue;
    const link = tag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const pubDate = tag(block, 'pubDate') || tag(block, 'dc:date');
    const published = pubDate ? new Date(pubDate) : new Date();
    items.push({
      id: link || headline,
      headline,
      summary: tag(block, 'description').slice(0, 480),
      source,
      url: link,
      image: block.match(/<media:content[^>]*url="([^"]+)"/i)?.[1] || null,
      publishedAt: isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
      related: ''
    });
  }
  return items;
}

async function curlText(url) {
  if (!/^https:\/\/(feeds\.finance\.yahoo\.com|news\.google\.com)\//.test(url)) return null;
  try {
    const { stdout } = await execAsync(
      `curl -sS -L --max-time 12 -A ${JSON.stringify(UA)} ${JSON.stringify(url)}`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    return stdout && stdout.includes('<item') ? stdout : null;
  } catch {
    return null;
  }
}

async function fetchFeed(url, sourceName) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      responseType: 'text',
      validateStatus: s => s >= 200 && s < 400
    });
    if (typeof res.data === 'string' && res.data.includes('<item')) {
      return parseRss(res.data, sourceName);
    }
  } catch { /* Yahoo often 429s Node clients */ }

  const viaCurl = await curlText(url);
  return viaCurl ? parseRss(viaCurl, sourceName) : [];
}

async function pLimit(tasks, n) {
  const out = [];
  for (let i = 0; i < tasks.length; i += n) {
    const chunk = await Promise.all(tasks.slice(i, i + n).map(fn => fn()));
    out.push(...chunk);
  }
  return out;
}

export async function getRssMarketNews() {
  return cached('rss_market', 10 * 60_000, async () => {
    const results = await Promise.allSettled(MARKET_FEEDS.map(f => fetchFeed(f.url, f.source)));
    return results
      .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
      .filter(a => Date.now() - new Date(a.publishedAt).getTime() < 3 * 86400000);
  });
}

function yahooUrls(ticker) {
  const sym = encodeURIComponent(ticker.toUpperCase());
  const urls = [
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`
  ];
  if (isInternationalTicker(ticker)) {
    urls.push(
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=GB&lang=en-GB`,
      `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=BE&lang=nl-BE`
    );
  }
  return urls;
}

export async function getRssStockNews(ticker) {
  const sym = ticker.toUpperCase();
  return cached(`rss_stock_${sym}`, 10 * 60_000, async () => {
    for (const url of yahooUrls(sym)) {
      const items = await fetchFeed(url, 'Yahoo Finance');
      if (items.length) {
        return items.map(i => ({ ...i, related: sym }));
      }
    }
    return [];
  });
}

function googleSearchUrl(query, locale) {
  const qs = new URLSearchParams({
    q: query,
    hl: locale.hl,
    gl: locale.gl,
    ceid: locale.ceid
  });
  return `https://news.google.com/rss/search?${qs}`;
}

export async function getGoogleStockNews(ticker, name) {
  const sym = String(ticker || '').toUpperCase();
  const terms = companySearchTerms(sym, name);
  if (!terms.length) return [];
  const quoted = terms.map(t => `"${t}"`).join(' OR ');
  const shortName = !terms.some(t => String(t).length >= 8);
  const q = isInternationalTicker(sym) && shortName
    ? `(${quoted}) (Euronext OR aandeel OR beurs OR Brussels OR Amsterdam OR "ENXTBR" OR Frankfurt) when:14d`
    : `(${quoted}) when:14d`;
  const locales = newsLocalesForSymbol(sym);

  return cached(`gnews_${sym}_${q}`, 10 * 60_000, async () => {
    const batches = await pLimit(
      locales.map(loc => () => fetchFeed(googleSearchUrl(q, loc), 'Google News')),
      3
    );
    const seen = new Set();
    const out = [];
    for (const item of batches.flat()) {
      const key = (item.headline || '').toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, related: sym });
    }
    return out.slice(0, 40);
  });
}
