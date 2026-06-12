// Keyless RSS news — zero API keys, zero quotas. Keeps the news feed alive
// even when Finnhub/NewsAPI are rate-limited or keys are missing.
// Sources: CNBC + MarketWatch (market-wide), Yahoo Finance per-ticker feed.

import axios from 'axios';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MARKET_FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', source: 'MarketWatch' },
  { url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Earnings' }
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

// Minimal RSS 2.0 item parser — avoids an XML dependency for 4 fields.
function parseRss(xml, sourceName) {
  const items = [];
  const matches = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of matches.slice(0, 25)) {
    const headline = tag(block, 'title');
    if (!headline) continue;
    const link = tag(block, 'link') || (block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const pubDate = tag(block, 'pubDate') || tag(block, 'dc:date');
    const published = pubDate ? new Date(pubDate) : new Date();
    items.push({
      id: link || headline,
      headline,
      summary: tag(block, 'description').slice(0, 280),
      source: sourceName,
      url: link,
      image: block.match(/<media:content[^>]*url="([^"]+)"/i)?.[1] || null,
      publishedAt: isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
      related: ''
    });
  }
  return items;
}

async function fetchFeed(url, sourceName) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
      responseType: 'text'
    });
    if (typeof res.data !== 'string') return [];
    return parseRss(res.data, sourceName);
  } catch {
    return [];
  }
}

export async function getRssMarketNews() {
  return cached('rss_market', 10 * 60_000, async () => {
    const results = await Promise.allSettled(MARKET_FEEDS.map(f => fetchFeed(f.url, f.source)));
    return results
      .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
      .filter(a => Date.now() - new Date(a.publishedAt).getTime() < 3 * 86400000);
  });
}

export async function getRssStockNews(ticker) {
  const sym = ticker.toUpperCase();
  return cached(`rss_stock_${sym}`, 10 * 60_000, async () => {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`;
    const items = await fetchFeed(url, 'Yahoo Finance');
    return items.map(i => ({ ...i, related: sym }));
  });
}
