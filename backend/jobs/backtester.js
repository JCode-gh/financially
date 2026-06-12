// Walk-forward backtester. Instead of waiting weeks for live predictions to
// resolve, replay the cached price history bar by bar: at each step compute
// signals from data up to that day, predict, check what actually happened,
// and apply the same online weight update the live evaluator uses.
//
// Result: the self-learning model arrives pre-trained on thousands of real
// outcomes, and the dashboard shows honest "backtest" accuracy from the most
// recent (already-trained) third of the walk — separate from live accuracy.
//
// News sentiment cannot be backtested (no free historical news), so its weight
// is left untouched and only adjusts from live resolved predictions.

import { getDB } from '../db/database.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import {
  getModelWeights, saveModelWeights, computeSignalSet, computeEnsembleScore,
  blendForHorizon, applyReturnToWeights, PREDICTION_THRESHOLDS
} from '../models/predictionEngine.js';

const HORIZONS = [
  { id: '1d', days: 1, name: 'h1d' },
  { id: '5d', days: 5, name: 'h5d' },
  { id: '30d', days: 21, name: 'h30d' } // ~30 calendar days ≈ 21 trading days
];
const BACKTEST_LR = 0.025;      // fast enough that weights track regime shifts
                                // (trend → chop) within a few dozen outcomes
const MIN_HISTORY = 260;        // need SMA200 + warmup
const STEP_STRIDE = 2;          // evaluate every 2nd bar — halves CPU, keeps coverage
const MAX_STEPS_PER_SYMBOL = 220;

export async function runBacktest(symbols, { log = true } = {}) {
  const db = getDB();
  // One independent weight vector per horizon, each Hebbian-trained on its own
  // forward return — what predicts tomorrow differs from what predicts a month.
  const weights = {};
  const startIterations = {};
  const startNews = {};
  for (const h of HORIZONS) {
    const row = getModelWeights(h.name);
    weights[h.id] = { ...row.weights };
    startIterations[h.id] = row.iteration;
    startNews[h.id] = row.weights.news_sentiment;
  }

  const stats = {};   // horizon → { total, correct } (recent third only = trained model)
  const indicatorStats = {};
  let updates = 0;
  const startedAt = Date.now();

  let symbolsUsed = 0;
  for (const symbol of symbols) {
    // Disk cache is primary (no network unless empty) — generous freshness.
    const candles = await getHistoricalSeries(symbol, 5000, 24 * 3600_000).catch(() => null);
    if (!candles || candles.length < MIN_HISTORY) continue;
    symbolsUsed++;

    const maxHorizon = Math.max(...HORIZONS.map(h => h.days));
    const lastIdx = candles.length - 1 - maxHorizon;
    const firstIdx = Math.max(MIN_HISTORY, lastIdx - MAX_STEPS_PER_SYMBOL * STEP_STRIDE);
    const evalStart = firstIdx + Math.floor((lastIdx - firstIdx) * 0.66); // stats from final third

    for (let i = firstIdx; i <= lastIdx; i += STEP_STRIDE) {
      const window = candles.slice(0, i + 1);
      const { signals } = computeSignalSet(window);
      const priceNow = candles[i].close;
      if (!priceNow) continue;

      for (const h of HORIZONS) {
        const future = candles[i + h.days];
        if (!future) continue;

        // Score with this horizon's CURRENT weights (before learning from this bar)
        const hScore = blendForHorizon(computeEnsembleScore(signals, weights[h.id]), h.id);
        const actualUp = future.close > priceNow;

        // Evaluate actionable calls in the trained (recent) segment
        const threshold = (PREDICTION_THRESHOLDS[h.id] || PREDICTION_THRESHOLDS['5d']).moderate;
        if (i >= evalStart && Math.abs(hScore) >= threshold) {
          const wasCorrect = (hScore >= 0) === actualUp;
          if (!stats[h.id]) stats[h.id] = { total: 0, correct: 0 };
          stats[h.id].total++;
          if (wasCorrect) stats[h.id].correct++;

          // Per-indicator stats against the 5d outcome (one tally per step)
          if (h.id === '5d') {
            for (const [ind, sig] of Object.entries(signals)) {
              if (!sig) continue;
              if (!indicatorStats[ind]) indicatorStats[ind] = { total: 0, correct: 0 };
              const indUp = sig > 0;
              indicatorStats[ind].total++;
              if (indUp === actualUp) indicatorStats[ind].correct++;
            }
          }
        }

        // Then learn from this bar's realized forward return
        const fwdReturnPct = ((future.close - priceNow) / priceNow) * 100;
        weights[h.id] = applyReturnToWeights(weights[h.id], signals, fwdReturnPct, BACKTEST_LR);
        updates++;
      }
    }
  }

  if (updates === 0) {
    if (log) console.log('[Backtest] No usable history found — skipped.');
    return { updates: 0, symbolsUsed: 0, results: {} };
  }

  // Persist each horizon's trained weights; news_sentiment weight stays as it
  // was (it can't be backtested — no free historical news — so only live
  // outcomes adjust it).
  const perHorizonUpdates = Math.round(updates / HORIZONS.length);
  for (const h of HORIZONS) {
    const w = weights[h.id];
    if (startNews[h.id] != null) w.news_sentiment = startNews[h.id];
    const total = Object.values(w).reduce((a, b) => a + Math.abs(b), 0);
    for (const k of Object.keys(w)) w[k] = parseFloat((w[k] / total).toFixed(6));
    saveModelWeights(w, startIterations[h.id] + perHorizonUpdates, h.name);
  }

  // Persist per-horizon backtest accuracy
  const upsert = db.prepare(`
    INSERT INTO backtest_results (horizon, total, correct, accuracy, symbols, details, trained_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(horizon) DO UPDATE SET
      total = excluded.total, correct = excluded.correct, accuracy = excluded.accuracy,
      symbols = excluded.symbols, details = excluded.details, trained_at = CURRENT_TIMESTAMP
  `);

  const results = {};
  const indDetails = Object.fromEntries(
    Object.entries(indicatorStats).map(([k, v]) => [k, {
      total: v.total,
      accuracy: v.total ? parseFloat((v.correct / v.total * 100).toFixed(1)) : null
    }])
  );
  for (const h of HORIZONS) {
    const s = stats[h.id] || { total: 0, correct: 0 };
    const accuracy = s.total ? s.correct / s.total : 0;
    results[h.id] = { ...s, accuracy };
    upsert.run(h.id, s.total, s.correct, accuracy, symbolsUsed, JSON.stringify(indDetails));
  }

  if (log) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const summary = HORIZONS.map(h => `${h.id} ${(results[h.id].accuracy * 100).toFixed(1)}% (${results[h.id].total})`).join(' · ');
    console.log(`[Backtest] ${symbolsUsed} symbols, ${updates} weight updates in ${secs}s → ${summary}`);
  }

  return { updates, symbolsUsed, results, weights };
}

export function getBacktestResults() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM backtest_results ORDER BY horizon').all();
  return rows.map(r => ({
    ...r,
    details: r.details ? JSON.parse(r.details) : null
  }));
}
