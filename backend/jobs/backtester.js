// Walk-forward backtester with honest out-of-sample metrics and trade P&L simulation.

import { getDB, LIVE_ONLY_WEIGHT_KEYS } from '../db/database.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import {
  getModelWeights, saveModelWeights, computeSignalSet, computeEnsembleScore,
  blendForHorizon, applyReturnToWeights, PREDICTION_THRESHOLDS, buildTradePlan
} from '../models/predictionEngine.js';
import {
  DEFAULT_COST_BPS, tradeReturnPct, tradeRMultiple, aggregateTradeMetrics
} from '../models/backtestMetrics.js';

const HORIZONS = [
  { id: '1d', days: 1, name: 'h1d' },
  { id: '5d', days: 5, name: 'h5d' },
  { id: '30d', days: 21, name: 'h30d' }
];
const BACKTEST_LR = 0.025;
const MIN_HISTORY = 260;
const STEP_STRIDE = 2;
const MAX_STEPS_PER_SYMBOL = 220;
const TRAIN_FRAC = 0.66;   // first 66% = train only
const EMBARGO_FRAC = 0.10; // last 10% of walk = pure OOS (never trained)

export async function runBacktest(symbols, { log = true, costBps = DEFAULT_COST_BPS } = {}) {
  const db = getDB();
  const weights = {};
  const startIterations = {};
  const frozenLiveWeights = {};

  for (const h of HORIZONS) {
    const row = getModelWeights(h.name);
    weights[h.id] = { ...row.weights };
    startIterations[h.id] = row.iteration;
    frozenLiveWeights[h.id] = {};
    for (const key of LIVE_ONLY_WEIGHT_KEYS) {
      if (row.weights[key] != null) frozenLiveWeights[h.id][key] = row.weights[key];
    }
  }
  const stats = {};
  const tradeLog = {}; // horizon → trade records (OOS only)
  const indicatorStats = {};
  let updates = 0;
  const startedAt = Date.now();
  let symbolsUsed = 0;

  for (const symbol of symbols) {
    const candles = await getHistoricalSeries(symbol, 5000, 24 * 3600_000).catch(() => null);
    if (!candles || candles.length < MIN_HISTORY) continue;
    symbolsUsed++;

    const maxHorizon = Math.max(...HORIZONS.map(h => h.days));
    const lastIdx = candles.length - 1 - maxHorizon;
    const firstIdx = Math.max(MIN_HISTORY, lastIdx - MAX_STEPS_PER_SYMBOL * STEP_STRIDE);
    const span = lastIdx - firstIdx;
    const trainEnd = firstIdx + Math.floor(span * TRAIN_FRAC);
    const oosStart = firstIdx + Math.floor(span * (1 - EMBARGO_FRAC));

    for (let i = firstIdx; i <= lastIdx; i += STEP_STRIDE) {
      const window = candles.slice(0, i + 1);
      const { signals, indicators } = computeSignalSet(window);
      const priceNow = candles[i].close;
      if (!priceNow) continue;

      const isTrain = i < trainEnd;
      const isOOS = i >= oosStart;

      for (const h of HORIZONS) {
        const future = candles[i + h.days];
        if (!future) continue;

        const hScore = blendForHorizon(computeEnsembleScore(signals, weights[h.id]), h.id);
        const actualUp = future.close > priceNow;
        const threshold = (PREDICTION_THRESHOLDS[h.id] || PREDICTION_THRESHOLDS['5d']).moderate;
        const strongThreshold = (PREDICTION_THRESHOLDS[h.id] || PREDICTION_THRESHOLDS['5d']).strong;

        // OOS evaluation only — embargo tail, weights may have seen middle segment
        if (isOOS && Math.abs(hScore) >= threshold) {
          const wasCorrect = (hScore >= 0) === actualUp;
          if (!stats[h.id]) stats[h.id] = { total: 0, correct: 0 };
          stats[h.id].total++;
          if (wasCorrect) stats[h.id].correct++;

          if (h.id === '5d') {
            for (const [ind, sig] of Object.entries(signals)) {
              if (!sig) continue;
              if (!indicatorStats[ind]) indicatorStats[ind] = { total: 0, correct: 0 };
              indicatorStats[ind].total++;
              if ((sig > 0) === actualUp) indicatorStats[ind].correct++;
            }
          }

          // Simulate trade with costs for strong signals
          if (Math.abs(hScore) >= strongThreshold) {
            const direction = hScore >= 0 ? 1 : -1;
            const plan = buildTradePlan(direction, indicators);
            const entry = plan?.entry ?? priceNow;
            const stop = plan?.stop ?? (direction > 0 ? priceNow * 0.97 : priceNow * 1.03);
            const exitPrice = future.close;
            const retPct = tradeReturnPct(direction, entry, exitPrice, costBps);
            const rMult = tradeRMultiple(direction, entry, stop, exitPrice);
            if (!tradeLog[h.id]) tradeLog[h.id] = [];
            tradeLog[h.id].push({ returnPct: retPct, rMultiple: rMult });
          }
        }

        // Learn only from train segment (no leakage into OOS metrics)
        if (isTrain) {
          const fwdReturnPct = ((future.close - priceNow) / priceNow) * 100;
          weights[h.id] = applyReturnToWeights(weights[h.id], signals, fwdReturnPct, BACKTEST_LR);
          updates++;
        }
      }
    }
  }

  if (updates === 0) {
    if (log) console.log('[Backtest] No usable history found — skipped.');
    return { updates: 0, symbolsUsed: 0, results: {} };
  }

  const perHorizonUpdates = Math.round(updates / HORIZONS.length);
  for (const h of HORIZONS) {
    const w = weights[h.id];
    for (const [key, val] of Object.entries(frozenLiveWeights[h.id])) {
      w[key] = val;
    }
    const total = Object.values(w).reduce((a, b) => a + Math.abs(b), 0);
    for (const k of Object.keys(w)) w[k] = parseFloat((w[k] / total).toFixed(6));
    saveModelWeights(w, startIterations[h.id] + perHorizonUpdates, h.name);
  }

  const upsert = db.prepare(`
    INSERT INTO backtest_results
      (horizon, total, correct, accuracy, symbols, details, trained_at,
       expectancy, profit_factor, max_drawdown, avg_rr, cost_bps, win_rate, sharpe_like)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(horizon) DO UPDATE SET
      total = excluded.total, correct = excluded.correct, accuracy = excluded.accuracy,
      symbols = excluded.symbols, details = excluded.details, trained_at = CURRENT_TIMESTAMP,
      expectancy = excluded.expectancy, profit_factor = excluded.profit_factor,
      max_drawdown = excluded.max_drawdown, avg_rr = excluded.avg_rr, cost_bps = excluded.cost_bps,
      win_rate = excluded.win_rate, sharpe_like = excluded.sharpe_like
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
    const pnl = aggregateTradeMetrics(tradeLog[h.id] || []);
    results[h.id] = { ...s, accuracy, pnl };
    upsert.run(
      h.id, s.total, s.correct, accuracy, symbolsUsed, JSON.stringify(indDetails),
      pnl.expectancy, pnl.profitFactor, pnl.maxDrawdown, pnl.avgR, costBps,
      pnl.winRate, pnl.sharpeLike
    );
  }

  if (log) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const bt5 = results['5d'];
    const summary = HORIZONS.map(h =>
      `${h.id} ${(results[h.id].accuracy * 100).toFixed(1)}% dir (${results[h.id].total} OOS)`
    ).join(' · ');
    const pnlSummary = bt5?.pnl?.total
      ? ` · 5d P&L: exp ${bt5.pnl.expectancy.toFixed(2)}% PF ${bt5.pnl.profitFactor.toFixed(2)} DD ${(bt5.pnl.maxDrawdown * 100).toFixed(1)}%`
      : '';
    console.log(`[Backtest] ${symbolsUsed} symbols, ${updates} train updates in ${secs}s → ${summary}${pnlSummary}`);
  }

  return { updates, symbolsUsed, results, weights, costBps };
}

export function getBacktestResults() {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM backtest_results ORDER BY horizon').all();
  return rows.map(r => ({
    ...r,
    details: r.details ? JSON.parse(r.details) : null
  }));
}
