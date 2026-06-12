import { Router } from 'express';
import { getMarketNews, getStockNews } from '../services/finnhub.js';
import { getTopFinancialNews, searchStockNews } from '../services/newsApi.js';
import { getRssMarketNews, getRssStockNews } from '../services/rssNews.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';

const router = Router();

const INVALID_TICKERS = new Set(['NULL', 'UNDEFINED', 'NONE', '']);

function isValidTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return false;
  const t = ticker.trim().toUpperCase();
  if (!t || INVALID_TICKERS.has(t)) return false;
  return /^[A-Z0-9]{1,10}(\.[A-Z]{1,4})?$/.test(t);
}

function dedupeAndSort(articles) {
  const seen = new Set();
  return articles
    .filter(a => {
      const key = (a.headline || '').toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

router.get('/market', async (req, res) => {
  try {
    const [finnhubNews, rssNews, newsApiNews] = await Promise.allSettled([
      getMarketNews('general'),
      getRssMarketNews(),
      getTopFinancialNews()
    ]);

    const articles = dedupeAndSort([
      ...(finnhubNews.status === 'fulfilled' ? finnhubNews.value : []),
      ...(rssNews.status === 'fulfilled' ? rssNews.value : []),
      ...(newsApiNews.status === 'fulfilled' ? newsApiNews.value : [])
    ]).slice(0, 60);

    const { articles: analyzed, score, label } = analyzeArticles(articles);
    res.json({ success: true, data: analyzed, marketSentiment: { score, label }, count: analyzed.length });
  } catch {
    res.json({ success: true, data: [], marketSentiment: { score: 0, label: 'neutral' }, count: 0 });
  }
});

router.get('/stock/:symbol', async (req, res) => {
  const ticker = (req.params.symbol || '').trim().toUpperCase();
  if (!isValidTicker(ticker)) {
    return res.json({
      success: true,
      data: [],
      stockSentiment: { ticker, score: 0, label: 'neutral' },
      count: 0
    });
  }
  try {
    const [finnhubNews, rssNews] = await Promise.allSettled([
      getStockNews(ticker),
      getRssStockNews(ticker)
    ]);

    let articles = dedupeAndSort([
      ...(finnhubNews.status === 'fulfilled' ? finnhubNews.value : []),
      ...(rssNews.status === 'fulfilled' ? rssNews.value : [])
    ]);

    // NewsAPI free tier is only 100 req/day — spend it only when the free
    // unlimited sources came up nearly empty for this ticker.
    if (articles.length < 3) {
      const extra = await searchStockNews(ticker, req.query.name).catch(() => []);
      articles = dedupeAndSort([...articles, ...(extra || [])]);
    }

    const { articles: analyzed, score, label, impactPct, buzz, topEvents } = analyzeArticles(articles, ticker);
    res.json({
      success: true,
      data: analyzed,
      stockSentiment: { ticker, score, label, impactPct, buzz, topEvents },
      count: analyzed.length
    });
  } catch {
    res.json({ success: true, data: [], stockSentiment: { ticker, score: 0, label: 'neutral' }, count: 0 });
  }
});

export default router;
