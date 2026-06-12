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
  // 30-min TTL keeps worst-case usage at ~48 of the 100 free requests/day
  return cached('newsapi_top', 1800_000, async () => {
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

const NON_FINANCIAL_SOURCES = /^(pypi|nature|seclists|plos|c-sharpcorner|github|reddit|stackoverflow|medium|dev\.to)/i;

function looksFinancial(article, ticker, companyName) {
  const text = `${article.title || ''} ${article.description || ''}`.toLowerCase();
  const source = (article.source?.name || '').toLowerCase();
  if (NON_FINANCIAL_SOURCES.test(source)) return false;

  const sym = ticker.toLowerCase();
  if (text.includes(sym)) return true;
  if (companyName && text.includes(companyName.toLowerCase())) return true;

  return /\b(stock|stocks|shares|earnings|revenue|market|investor|trading|ipo|dividend|quarter|analyst|price target|wall street|nasdaq|nyse)\b/i.test(text);
}

export async function searchStockNews(ticker, companyName) {
  const sym = ticker.toUpperCase();
  const namePart = companyName ? `"${companyName}" OR ` : '';
  const q = `(${namePart}"${sym}") AND (stock OR shares OR earnings OR trading OR market OR investor)`;
  return cached(`newsapi_${sym}`, 1800_000, async () => {
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
      .filter(a => looksFinancial(a, sym, companyName))
      .map(a => ({
        id: a.url,
        headline: a.title,
        summary: a.description || '',
        source: a.source?.name || 'NewsAPI',
        url: a.url,
        image: a.urlToImage,
        publishedAt: a.publishedAt,
        related: sym
      }));
  });
}
