import { Router } from 'express';
import {
  getQuote,
  getQuotes,
  getMarket,
  getHistorical,
  getHistoricalBatch,
  search,
  resolveSymbol
} from '../providers/marketData.js';
import { asyncHandler, AppError, ok } from '../lib/errors.js';
import { requireTicker, parseSymbols, clampInt } from '../lib/validate.js';

const router = Router();

router.get('/watchlist', asyncHandler(async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, { max: 60 });
  if (!symbols.length) return ok(res, []);
  const data = await getQuotes(symbols);
  if (!data.length) throw new AppError('Quote data unavailable', 503, 'NO_QUOTES');
  return ok(res, data);
}));

router.get('/market', asyncHandler(async (req, res) => {
  const data = await getMarket();
  if (!data.length) throw new AppError('Market data unavailable', 503, 'NO_MARKET');
  return ok(res, data);
}));

router.get('/quote/:symbol', asyncHandler(async (req, res) => {
  const symbol = requireTicker(req.params.symbol);
  const data = await getQuote(symbol);
  if (!data) throw new AppError(`Quote unavailable for ${symbol}`, 503, 'NO_QUOTE');
  return ok(res, data);
}));

router.get('/historical-batch', asyncHandler(async (req, res) => {
  const symbols = parseSymbols(req.query.symbols, { max: 24 });
  const days = clampInt(req.query.days, { min: 5, max: 200, fallback: 63 });
  if (!symbols.length) return ok(res, {});
  return ok(res, await getHistoricalBatch(symbols, days));
}));

router.get('/historical/:symbol', asyncHandler(async (req, res) => {
  const symbol = requireTicker(req.params.symbol);
  const interval = String(req.query.interval || '1day');
  const days = clampInt(req.query.days, { min: 1, max: 5000, fallback: interval === '1day' ? 100 : 500 });
  const data = await getHistorical(symbol, { days, interval });
  if (!data?.length) throw new AppError(`Historical data unavailable for ${symbol}`, 503, 'NO_HISTORY');
  return ok(res, data, { interval });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  return ok(res, await search(q, 15));
}));

router.get('/resolve', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  return ok(res, await resolveSymbol(q));
}));

export default router;
