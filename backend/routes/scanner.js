import { Router } from 'express';
import { runScan, getLatestScan, getAlerts, SCAN_SYMBOLS } from '../jobs/scanner.js';
import { getUpcomingEarnings } from '../services/earningsCalendar.js';
import { getBacktestResults } from '../jobs/backtester.js';
import { getDB } from '../db/database.js';
import { SCAN_GATES } from '../models/scannerScoring.js';

const router = Router();

function getScanMeta() {
  const db = getDB();
  const backtest = getBacktestResults();
  const bt5d = backtest.find(b => b.horizon === '5d');
  const live = db.prepare('SELECT * FROM accuracy_metrics WHERE horizon = ?').get('5d');
  return {
    backtest5d: bt5d ? { accuracy: bt5d.accuracy, total: bt5d.total, trainedAt: bt5d.trained_at } : null,
    live5d: live?.total > 0 ? { accuracy: live.accuracy, total: live.total, correct: live.correct } : null,
    gates: {
      minScore: SCAN_GATES.action,
      minConfidence: SCAN_GATES.minConfidence,
      minRR: SCAN_GATES.minRR
    }
  };
}

// Latest completed scan, ranked by quality
router.get('/latest', (req, res) => {
  try {
    const data = getLatestScan();
    res.json({ success: true, data: { ...data, meta: getScanMeta() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger a scan now (also used by the frontend's refresh button)
router.post('/run', async (req, res) => {
  try {
    const bodySymbols = (req.body?.symbols || [])
      .map(s => String(s).trim().toUpperCase())
      .filter(Boolean);
    const symbols = bodySymbols.length ? bodySymbols : SCAN_SYMBOLS;
    const result = await runScan(symbols);
    if (result.skipped) {
      return res.json({ success: true, data: { ...getLatestScan(), meta: getScanMeta() }, note: 'scan already in progress' });
    }
    res.json({ success: true, data: { runAt: new Date().toISOString(), results: result.results, meta: getScanMeta() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Recent alerts (signal changes, news spikes, earnings warnings)
router.get('/alerts', (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit || '40', 10));
    res.json({ success: true, data: getAlerts(limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upcoming earnings for the watchlist (next 21 days)
router.get('/earnings', async (req, res) => {
  try {
    const map = await getUpcomingEarnings();
    const symbols = (req.query.symbols || SCAN_SYMBOLS.join(','))
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
