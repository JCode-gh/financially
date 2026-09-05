import { Router } from 'express';
import { getMarketNewsBundle, getStockNewsBundle, getStockChartNews } from '../providers/news.js';
import { asyncHandler, ok } from '../lib/errors.js';
import { clampInt, normalizeTicker, parseSymbols } from '../lib/validate.js';

const router = Router();

router.get('/market', asyncHandler(async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, { max: 40 });
  const names = String(req.query.names || '').split('|');
  const tickers = symbols.map((symbol, i) => ({ symbol, name: names[i] || '' }));
  const bundle = await getMarketNewsBundle(tickers);
  return ok(res, bundle.articles, {
    marketSentiment: bundle.marketSentiment,
    count: bundle.count
  });
}));

router.get('/stock/:symbol/history', asyncHandler(async (req, res) => {
  const ticker = normalizeTicker(req.params.symbol);
  if (!ticker) return ok(res, [], { count: 0 });
  const days = clampInt(req.query.days, { min: 30, max: 400, fallback: 400 });
  const articles = await getStockChartNews(ticker, days);
  return ok(res, articles, { count: articles.length });
}));

router.get('/stock/:symbol', asyncHandler(async (req, res) => {
  const ticker = normalizeTicker(req.params.symbol);
  if (!ticker) {
    return ok(res, [], {
      stockSentiment: { ticker: req.params.symbol, score: 0, label: 'neutral' },
      count: 0
    });
  }
  const bundle = await getStockNewsBundle(ticker, req.query.name);
  return ok(res, bundle.articles, {
    stockSentiment: bundle.stockSentiment,
    count: bundle.count
  });
}));

export default router;
