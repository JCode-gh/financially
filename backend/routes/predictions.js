import { Router } from 'express';
import { getDB } from '../db/database.js';
import { getStockNews } from '../services/finnhub.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { generatePredictions, getModelWeights } from '../models/predictionEngine.js';
import { evaluatePredictions, recalculateAccuracy } from '../jobs/predictionEvaluator.js';

const router = Router();

router.get('/accuracy', (req, res) => {
  const db = getDB();
  const metrics = db.prepare('SELECT * FROM accuracy_metrics ORDER BY horizon').all();
  const weights = getModelWeights();

  // Per-indicator accuracy breakdown from recent predictions
  const recentPreds = db.prepare(`
    SELECT signals, weights_used, correct, score, horizon
    FROM predictions WHERE correct IS NOT NULL
    ORDER BY resolved_at DESC LIMIT 200
  `).all();

  const indicatorStats = {};
  recentPreds.forEach(p => {
    let signals;
    try { signals = JSON.parse(p.signals); } catch { return; }
    const expected = p.score >= 0 ? 1 : -1;
    for (const [ind, sig] of Object.entries(signals)) {
      if (!indicatorStats[ind]) indicatorStats[ind] = { correct: 0, total: 0 };
      const signalDir = sig > 0 ? 1 : sig < 0 ? -1 : 0;
      if (signalDir !== 0) {
        indicatorStats[ind].total++;
        if ((signalDir === expected && p.correct === 1) ||
            (signalDir !== expected && p.correct === 0)) {
          indicatorStats[ind].correct++;
        }
      }
    }
  });

  res.json({
    success: true,
    data: {
      horizons: metrics,
      modelWeights: weights.weights,
      modelIteration: weights.iteration,
      indicatorStats: Object.fromEntries(
        Object.entries(indicatorStats).map(([k, v]) => [k, {
          ...v,
          accuracy: v.total > 0 ? parseFloat((v.correct / v.total * 100).toFixed(1)) : null
        }])
      ),
      totalResolved: recentPreds.length
    }
  });
});

router.get('/history', (req, res) => {
  const db = getDB();
  const { ticker, horizon, limit = 50, resolved } = req.query;

  let query = 'SELECT * FROM predictions WHERE 1=1';
  const params = [];

  if (ticker) { query += ' AND ticker = ?'; params.push(ticker.toUpperCase()); }
  if (horizon) { query += ' AND horizon = ?'; params.push(horizon); }
  if (resolved === 'true') query += ' AND correct IS NOT NULL';
  if (resolved === 'false') query += ' AND correct IS NULL';

  query += ' ORDER BY predicted_at DESC LIMIT ?';
  params.push(parseInt(limit, 10));

  const rows = db.prepare(query).all(...params);
  res.json({
    success: true,
    data: rows.map(r => ({
      ...r,
      signals: JSON.parse(r.signals),
      weights_used: JSON.parse(r.weights_used)
    }))
  });
});

router.post('/generate/:symbol', async (req, res) => {
  const ticker = req.params.symbol.toUpperCase();
  try {
    const [candlesResult, articlesResult] = await Promise.allSettled([
      getHistoricalSeries(ticker, 150),
      getStockNews(ticker)
    ]);

    // Persistent multi-source provider (Twelve Data → Yahoo → Alpha Vantage → disk cache)
    const candleData = candlesResult.status === 'fulfilled' ? candlesResult.value : null;
    if (!candleData || candleData.length < 30) {
      return res.status(503).json({ success: false, error: `Insufficient historical data for ${ticker} to run model` });
    }

    const articles = (articlesResult.status === 'fulfilled' && articlesResult.value?.length)
      ? articlesResult.value
      : [];

    const result = await generatePredictions(ticker, candleData, articles);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:symbol', (req, res) => {
  const db = getDB();
  const ticker = req.params.symbol.toUpperCase();

  const latest = db.prepare(`
    SELECT p.*, m.weights as current_weights
    FROM predictions p
    CROSS JOIN model_weights m ON m.name = 'global'
    WHERE p.ticker = ?
    ORDER BY p.predicted_at DESC
    LIMIT 30
  `).all(ticker);

  const activePreds = db.prepare(`
    SELECT * FROM predictions
    WHERE ticker = ? AND correct IS NULL
    ORDER BY predicted_at DESC
  `).all(ticker);

  res.json({
    success: true,
    data: {
      active: activePreds.map(r => ({
        ...r,
        signals: JSON.parse(r.signals),
        weights_used: JSON.parse(r.weights_used)
      })),
      history: latest.map(r => ({
        ...r,
        signals: JSON.parse(r.signals),
        weights_used: JSON.parse(r.weights_used),
        current_weights: JSON.parse(r.current_weights)
      }))
    }
  });
});

// Manual trigger for evaluation (useful for testing)
router.post('/evaluate', async (req, res) => {
  try {
    const result = await evaluatePredictions();
    recalculateAccuracy();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
