import { Router } from 'express';
import { getMarketNews, getStockNews } from '../services/finnhub.js';
import { getTopFinancialNews, searchStockNews } from '../services/newsApi.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';

const router = Router();

function dedupeAndSort(articles) {
  const seen = new Set();
  return articles
    .filter(a => {
      if (!a.headline || seen.has(a.headline)) return false;
      seen.add(a.headline);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

router.get('/market', async (req, res) => {
  try {
    const [finnhubNews, newsApiNews] = await Promise.allSettled([
      getMarketNews('general'),
      getTopFinancialNews()
    ]);

    const articles = dedupeAndSort([
      ...(finnhubNews.status === 'fulfilled' ? finnhubNews.value : []),
      ...(newsApiNews.status === 'fulfilled' ? newsApiNews.value : [])
    ]);

    const { articles: analyzed, score, label } = analyzeArticles(articles);
    res.json({ success: true, data: analyzed, marketSentiment: { score, label }, count: analyzed.length });
  } catch {
    res.json({ success: true, data: [], marketSentiment: { score: 0, label: 'neutral' }, count: 0 });
  }
});

router.get('/stock/:symbol', async (req, res) => {
  const ticker = req.params.symbol.toUpperCase();
  try {
    const [finnhubNews, newsApiNews] = await Promise.allSettled([
      getStockNews(ticker),
      searchStockNews(ticker, req.query.name)
    ]);

    const articles = dedupeAndSort([
      ...(finnhubNews.status === 'fulfilled' ? finnhubNews.value : []),
      ...(newsApiNews.status === 'fulfilled' ? newsApiNews.value : [])
    ]);

    const { articles: analyzed, score, label } = analyzeArticles(articles);
    res.json({ success: true, data: analyzed, stockSentiment: { ticker, score, label }, count: analyzed.length });
  } catch {
    res.json({ success: true, data: [], stockSentiment: { ticker, score: 0, label: 'neutral' }, count: 0 });
  }
});

export default router;
