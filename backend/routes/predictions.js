import { Router } from 'express';
import { getDB } from '../db/database.js';
import { getStockNews } from '../services/finnhub.js';
import { getRssStockNews } from '../services/rssNews.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import {
  generatePredictions, getModelWeights, getHorizonWeights,
  computeScore, buildTradePlanForDays, buildReasons, horizonTarget,
  scoreToPrediction, PREDICTION_THRESHOLDS
} from '../models/predictionEngine.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';
import { evaluatePredictions, recalculateAccuracy } from '../jobs/predictionEvaluator.js';
import { runBacktest, getBacktestResults } from '../jobs/backtester.js';
import { getSymbolsReadyForScan } from '../jobs/historyWarmer.js';
import { getCalibrationCurve } from '../models/calibration.js';

const router = Router();

router.get('/accuracy', (req, res) => {
  const db = getDB();
  const metrics = db.prepare('SELECT * FROM accuracy_metrics ORDER BY horizon').all();
  const weights = getModelWeights();
  const backtest = getBacktestResults();

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
      backtest: backtest.map(b => ({
        horizon: b.horizon, total: b.total, correct: b.correct,
        accuracy: b.accuracy, symbols: b.symbols, trainedAt: b.trained_at,
        indicators: b.details,
        expectancy: b.expectancy,
        profitFactor: b.profit_factor,
        maxDrawdown: b.max_drawdown,
        avgR: b.avg_rr,
        winRate: b.win_rate,
        sharpeLike: b.sharpe_like,
        costBps: b.cost_bps
      })),
      calibration: {
        '5d': getCalibrationCurve('5d'),
        '1d': getCalibrationCurve('1d'),
        '30d': getCalibrationCurve('30d')
      },
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

// Re-train the model by walking forward through cached history
router.post('/backtest', async (req, res) => {
  try {
    const result = await runBacktest(getSymbolsReadyForScan());
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
    // 500 trading days — SMA200, 52-week range, golden/death cross all need deep history
    const [candlesResult, finnhubResult, rssResult] = await Promise.allSettled([
      getHistoricalSeries(ticker, 500),
      getStockNews(ticker),
      getRssStockNews(ticker)
    ]);

    // Persistent multi-source provider (Twelve Data → Yahoo → Stooq → AV → disk cache)
    const candleData = candlesResult.status === 'fulfilled' ? candlesResult.value : null;
    if (!candleData || candleData.length < 30) {
      return res.status(503).json({ success: false, error: `Insufficient historical data for ${ticker} to run model` });
    }

    const seen = new Set();
    const articles = [
      ...(finnhubResult.status === 'fulfilled' && finnhubResult.value ? finnhubResult.value : []),
      ...(rssResult.status === 'fulfilled' && rssResult.value ? rssResult.value : [])
    ].filter(a => {
      const key = (a.headline || '').toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const result = await generatePredictions(ticker, candleData, articles);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/trade-setup/:symbol', async (req, res) => {
  const ticker = req.params.symbol.toUpperCase();
  const maxDays = Math.min(31, Math.max(1, parseInt(req.body?.maxDays || 5, 10)));

  try {
    const [candlesResult, finnhubResult, rssResult] = await Promise.allSettled([
      getHistoricalSeries(ticker, 500),
      getStockNews(ticker),
      getRssStockNews(ticker)
    ]);

    const candles = candlesResult.status === 'fulfilled' ? candlesResult.value : null;
    if (!candles || candles.length < 30) {
      return res.status(503).json({ success: false, error: `Insufficient historical data for ${ticker}` });
    }

    const seen = new Set();
    const articles = [
      ...(finnhubResult.status === 'fulfilled' && finnhubResult.value ? finnhubResult.value : []),
      ...(rssResult.status === 'fulfilled' && rssResult.value ? rssResult.value : [])
    ].filter(a => {
      const key = (a.headline || '').toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const horizonWeights = getHorizonWeights();
    const newsSentiment = analyzeArticles(articles, ticker);
    const { score, indicators, signals, trend } = computeScore(candles, horizonWeights, newsSentiment.score);

    const price = indicators.price;
    const atr = indicators.atr || price * 0.02;
    const t5 = PREDICTION_THRESHOLDS['5d'];
    const direction = score >= t5.moderate ? 1 : score <= -t5.moderate ? -1 : 0;
    const { confidence } = scoreToPrediction(score, '5d');

    const tradePlan = direction !== 0
      ? buildTradePlanForDays(direction, indicators, maxDays)
      : null;

    const reasons = buildReasons(indicators, signals, newsSentiment, direction);
    const { expectedMovePct } = horizonTarget(maxDays, score, price, atr);

    res.json({
      success: true,
      data: {
        ticker, maxDays, direction: direction > 0 ? 'LONG' : direction < 0 ? 'SHORT' : 'NEUTRAL',
        confidence: parseFloat(confidence.toFixed(3)),
        expectedMovePct: parseFloat(expectedMovePct.toFixed(2)),
        tradePlan,
        reasons,
        trend: { label: trend.label, direction: trend.direction },
        support:    indicators.sr?.support?.price    ? parseFloat(indicators.sr.support.price.toFixed(2))    : null,
        resistance: indicators.sr?.resistance?.price ? parseFloat(indicators.sr.resistance.price.toFixed(2)) : null,
        atr: atr ? parseFloat(atr.toFixed(2)) : null,
        price: parseFloat(price.toFixed(2))
      }
    });
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
