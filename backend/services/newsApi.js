import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const KEY = process.env.NEWS_API_KEY || '';
const BASE = 'https://newsapi.org/v2';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data);
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

async function get(path, params = {}) {
  if (!KEY) return null;
  try {
    const res = await axios.get(`${BASE}${path}`, {
      params: { ...params, apiKey: KEY, language: 'en' },
      timeout: 8000
    });
    return res.data;
  } catch {
    return null;
  }
}

export async function getTopFinancialNews() {
  return cached('newsapi_top', 900_000, async () => {
    const data = await get('/top-headlines', {
      category: 'business',
      pageSize: 30
    });
    if (!data || !data.articles) return [];
    return data.articles
      .filter(a => a.title && !a.title.includes('[Removed]'))
      .map(a => ({
        id: a.url,
        headline: a.title,
        summary: a.description || '',
        source: a.source?.name || 'NewsAPI',
        url: a.url,
        image: a.urlToImage,
        publishedAt: a.publishedAt,
        related: ''
      }));
  });
}

export async function searchStockNews(ticker, companyName) {
  const q = companyName ? `${companyName} OR ${ticker} stock` : `${ticker} stock`;
  return cached(`newsapi_${ticker}`, 600_000, async () => {
    const from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const data = await get('/everything', {
      q,
      from,
      sortBy: 'relevancy',
      pageSize: 20
    });
    if (!data || !data.articles) return [];
    return data.articles
      .filter(a => a.title && !a.title.includes('[Removed]'))
      .map(a => ({
        id: a.url,
        headline: a.title,
        summary: a.description || '',
        source: a.source?.name || 'NewsAPI',
        url: a.url,
        image: a.urlToImage,
        publishedAt: a.publishedAt,
        related: ticker
      }));
  });
}
