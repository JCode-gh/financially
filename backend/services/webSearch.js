import axios from 'axios';
import { createTtlCache } from '../lib/cache.js';
import { searchGoogleNews } from './rssNews.js';

const { cached } = createTtlCache();
const OLLAMA_SEARCH = 'https://ollama.com/api/web_search';
const UA = 'Financially/1.0 (self-hosted market desk; local assistant)';

export function ollamaWebSearchEnabled() {
  return !!String(process.env.OLLAMA_API_KEY || '').trim();
}

function clip(s, n = 420) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function dedupe(items) {
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

async function ollamaWebSearch(query, maxResults) {
  const key = String(process.env.OLLAMA_API_KEY || '').trim();
  if (!key) return [];
  const res = await axios.post(OLLAMA_SEARCH, {
    query,
    max_results: Math.min(10, Math.max(1, maxResults))
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 12000
  });
  return (res.data?.results || []).map(r => ({
    title: clip(r.title, 160),
    url: String(r.url || ''),
    content: clip(r.content, 500),
    source: 'web'
  })).filter(r => r.title);
}

async function wikiSummary(query, lang) {
  const langCode = lang === 'nl' ? 'nl' : 'en';
  const search = await axios.get(`https://${langCode}.wikipedia.org/w/api.php`, {
    params: { action: 'opensearch', search: query, limit: 1, namespace: 0, format: 'json' },
    headers: { 'User-Agent': UA },
    timeout: 5000
  });
  const title = search.data?.[1]?.[0];
  if (!title) return null;
  const page = await axios.get(
    `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 5000 }
  );
  const extract = clip(page.data?.extract, 600);
  if (!extract) return null;
  return {
    title: page.data.title || title,
    url: page.data.content_urls?.desktop?.page || `https://${langCode}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    content: extract,
    source: 'wikipedia'
  };
}

async function newsHits(query, lang) {
  const items = await searchGoogleNews(query, { lang }).catch(() => []);
  return (items || []).map(a => ({
    title: clip(a.headline, 160),
    url: String(a.url || ''),
    content: clip(a.summary, 420),
    source: a.source || 'Google News'
  })).filter(r => r.title);
}

export async function webSearch(query, { lang = 'en', maxResults = 6 } = {}) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!q) return [];
  return cached(`web_${lang}_${q}`, 6 * 60_000, async () => {
    const jobs = [
      ollamaWebSearchEnabled()
        ? ollamaWebSearch(q, maxResults).catch(() => [])
        : Promise.resolve([]),
      newsHits(q, lang).catch(() => []),
      wikiSummary(q, lang).catch(() => null)
    ];
    const [web, news, wiki] = await Promise.all(jobs);
    const merged = dedupe([
      ...(web || []),
      ...(wiki ? [wiki] : []),
      ...(news || [])
    ]).slice(0, maxResults);
    return merged;
  });
}

export function formatSearchBlock(results) {
  if (!results?.length) return '(no extra search hits)';
  return results.map((r, i) => {
    const body = r.content ? `\n${r.content}` : '';
    return `${i + 1}. ${r.title}${r.source ? ` (${r.source})` : ''}${r.url ? `\n${r.url}` : ''}${body}`;
  }).join('\n\n');
}
