import { Router } from 'express';
import { runScan, getLatestScan, getAlerts } from '../jobs/scanner.js';
import { getUpcomingEarnings } from '../services/earningsCalendar.js';
import { getBacktestResults } from '../jobs/backtester.js';
import { getDB } from '../db/database.js';
import { SCAN_GATES } from '../models/scannerScoring.js';
import { getSymbolsReadyForScan, getWarmerStatus } from '../jobs/historyWarmer.js';
import { getMarketRegime } from '../models/marketRegime.js';

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

router.get('/latest', async (req, res) => {
  try {
    const data = getLatestScan();
    res.json({ success: true, data: { ...data, meta: await getScanMeta() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const bodySymbols = (req.body?.symbols || [])
      .map(s => String(s).trim().toUpperCase())
      .filter(Boolean);
    const symbols = bodySymbols.length ? bodySymbols : getSymbolsReadyForScan();
    const result = await runScan(symbols);
    if (result.skipped) {
      return res.json({ success: true, data: { ...getLatestScan(), meta: await getScanMeta() }, note: 'scan already in progress' });
    }
    res.json({
      success: true,
      data: {
        runAt: new Date().toISOString(),
        results: result.results,
        meta: await getScanMeta()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit || '40', 10));
    res.json({ success: true, data: getAlerts(limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/earnings', async (req, res) => {
  try {
    const map = await getUpcomingEarnings();
    const symbols = (req.query.symbols || getSymbolsReadyForScan().join(','))
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const filtered = {};
    for (const sym of symbols) {
      const hit = map[sym] || map[sym.replace('-', '.')];
      if (hit) filtered[sym] = hit;
    }
    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
