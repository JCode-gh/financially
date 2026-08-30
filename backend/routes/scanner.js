import { Router } from 'express';
import { runScan, getLatestScan, getAlerts } from '../jobs/scanner.js';
import { getUpcomingEarnings } from '../services/earningsCalendar.js';
import { getBacktestResults } from '../jobs/backtester.js';
import { getDB } from '../db/database.js';
import { SCAN_GATES } from '../models/scannerScoring.js';
import { getSymbolsReadyForScan, getWarmerStatus } from '../jobs/historyWarmer.js';
import { getMarketRegime } from '../models/marketRegime.js';
import { asyncHandler, ok } from '../lib/errors.js';
import { parseSymbols, clampInt } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { withLock } from '../lib/jobLock.js';

const router = Router();

async function getScanMeta() {
  const db = getDB();
  const backtest = getBacktestResults();
  const bt5d = backtest.find(b => b.horizon === '5d');
  const live = db.prepare('SELECT * FROM accuracy_metrics WHERE horizon = ?').get('5d');
  const warmer = getWarmerStatus();
  let regime = { label: 'neutral' };
  try { regime = await getMarketRegime(); } catch { /* ignore */ }

  return {
    backtest5d: bt5d ? {
      accuracy: bt5d.accuracy,
      total: bt5d.total,
      trainedAt: bt5d.trained_at,
      expectancy: bt5d.expectancy,
      profitFactor: bt5d.profit_factor,
      maxDrawdown: bt5d.max_drawdown,
      winRate: bt5d.win_rate,
      sharpeLike: bt5d.sharpe_like
    } : null,
    live5d: live?.total > 0 ? { accuracy: live.accuracy, total: live.total, correct: live.correct } : null,
    gates: {
      minScore: SCAN_GATES.action,
      minConfidence: SCAN_GATES.minConfidence,
      minRR: SCAN_GATES.minRR
    },
    universe: warmer,
    marketRegime: regime
  };
}

router.get('/latest', asyncHandler(async (req, res) => {
  const data = getLatestScan();
  return ok(res, { ...data, meta: await getScanMeta() });
}));

router.post('/run', rateLimit({ windowMs: 10 * 60_000, max: 6 }), asyncHandler(async (req, res) => {
  const raw = Array.isArray(req.body?.symbols) ? req.body.symbols.join(',') : '';
  const bodySymbols = parseSymbols(raw, { max: 80 });
  const symbols = bodySymbols.length ? bodySymbols : getSymbolsReadyForScan();

  const result = await withLock('scan', () => runScan(symbols));
  if (result?.skipped) {
    return ok(res, { ...getLatestScan(), meta: await getScanMeta() }, { note: 'scan already in progress' });
  }
  return ok(res, {
    runAt: new Date().toISOString(),
    results: result.results,
    meta: await getScanMeta()
  });
}));

router.get('/alerts', (req, res) => {
  const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 40 });
  return ok(res, getAlerts(limit));
});

router.get('/earnings', asyncHandler(async (req, res) => {
  const map = await getUpcomingEarnings();
  const symbols = parseSymbols(req.query.symbols || getSymbolsReadyForScan().join(','), { max: 80 });
  const filtered = {};
  for (const sym of symbols) {
    const hit = map[sym] || map[sym.replace('-', '.')];
    if (hit) filtered[sym] = hit;
  }
  return ok(res, filtered);
}));

export default router;
