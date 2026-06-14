// Standalone walk-forward evaluation harness for the prediction model.
// Reads cached daily candles from disk, runs the SAME engine functions the live
// model and backtester use, and reports honest out-of-sample metrics so model
// changes can be A/B compared. Does NOT touch the live DB.
//
//   node scripts/evalModel.js
//
// Metrics per horizon:
//   - dirAcc: directional hit-rate on ACTIONABLE calls (|score| >= threshold), NEUTRAL excluded
//   - coverage: % of bars that produced an actionable call
//   - edge over base: dirAcc minus the up-rate base (what "always long" would get)
//   - P&L: expectancy %, profit factor, avg R, max drawdown on STRONG calls (traded)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeSignalSet, computeEnsembleScore, blendForHorizon, applyAgreementGate,
  applyReturnToWeights, PREDICTION_THRESHOLDS, buildTradePlan
} from '../models/predictionEngine.js';
import { DEFAULT_WEIGHTS, LIVE_ONLY_WEIGHT_KEYS } from '../db/database.js';
import { aggregateTradeMetrics, tradeReturnPct, tradeRMultiple, DEFAULT_COST_BPS } from '../models/backtestMetrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HIST_DIR = path.join(__dirname, '..', 'data', 'history');

const HORIZONS = [
  { id: '1d', days: 1 },
  { id: '5d', days: 5 },
  { id: '30d', days: 21 }
];
const BACKTEST_LR = 0.025;
const MIN_HISTORY = 260;
const STEP_STRIDE = 2;
const MAX_STEPS_PER_SYMBOL = 400;
const TRAIN_FRAC = 0.66;
const EMBARGO_FRAC = 0.10;

function loadAllSymbols() {
  const files = fs.readdirSync(HIST_DIR).filter(f => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8'));
      if (obj?.candles?.length >= MIN_HISTORY) out.push({ symbol: obj.symbol || f.replace('.json', ''), candles: obj.candles });
    } catch { /* skip */ }
  }
  return out;
}

export function runEval({ log = true } = {}) {
  const universe = loadAllSymbols();
  const weights = {};
  for (const h of HORIZONS) weights[h.id] = { ...DEFAULT_WEIGHTS };

  const stats = {};        // horizon -> { total, correct } actionable, OOS
  const upBase = {};       // horizon -> { total, up } base rate, OOS
  const tradeLog = {};     // horizon -> trade records, OOS, strong only
  const indicatorStats = {}; // 5d only

  for (const { candles } of universe) {
    const maxHorizon = Math.max(...HORIZONS.map(h => h.days));
    const lastIdx = candles.length - 1 - maxHorizon;
    const firstIdx = Math.max(MIN_HISTORY, lastIdx - MAX_STEPS_PER_SYMBOL * STEP_STRIDE);
    const span = lastIdx - firstIdx;
    if (span <= 0) continue;
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
        const t = PREDICTION_THRESHOLDS[h.id] || PREDICTION_THRESHOLDS['5d'];
        const hScore = applyAgreementGate(
          blendForHorizon(computeEnsembleScore(signals, weights[h.id]), h.id),
          signals, indicators
        );
        const actualUp = future.close > priceNow;

        if (isOOS) {
          if (!upBase[h.id]) upBase[h.id] = { total: 0, up: 0 };
          upBase[h.id].total++;
          if (actualUp) upBase[h.id].up++;

          if (Math.abs(hScore) >= t.moderate) {
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

            if (Math.abs(hScore) >= t.strong) {
              const direction = hScore >= 0 ? 1 : -1;
              const plan = buildTradePlan(direction, indicators);
              const entry = plan?.entry ?? priceNow;
              const stop = plan?.stop ?? (direction > 0 ? priceNow * 0.97 : priceNow * 1.03);
              const retPct = tradeReturnPct(direction, entry, future.close, DEFAULT_COST_BPS);
              const rMult = tradeRMultiple(direction, entry, stop, future.close);
              if (!tradeLog[h.id]) tradeLog[h.id] = [];
              tradeLog[h.id].push({ returnPct: retPct, rMultiple: rMult });
            }
          }
        }

        if (isTrain) {
          const fwdReturnPct = ((future.close - priceNow) / priceNow) * 100;
          weights[h.id] = applyReturnToWeights(weights[h.id], signals, fwdReturnPct, BACKTEST_LR);
        }
      }
    }
  }

  const results = {};
  for (const h of HORIZONS) {
    const s = stats[h.id] || { total: 0, correct: 0 };
    const base = upBase[h.id] || { total: 0, up: 0 };
    const dirAcc = s.total ? s.correct / s.total : 0;
    const baseUp = base.total ? base.up / base.total : 0;
    const coverage = base.total ? s.total / base.total : 0;
    const pnl = aggregateTradeMetrics(tradeLog[h.id] || []);
    results[h.id] = { dirAcc, baseUp, coverage, n: s.total, pnl };
  }

  if (log) {
    console.log(`\n=== Walk-forward OOS eval · ${universe.length} symbols ===`);
    for (const h of HORIZONS) {
      const r = results[h.id];
      const edge = ((r.dirAcc - Math.max(r.baseUp, 1 - r.baseUp)) * 100).toFixed(1);
      console.log(
        `${h.id.padEnd(4)} dirAcc ${(r.dirAcc * 100).toFixed(1)}%  ` +
        `base ${(r.baseUp * 100).toFixed(1)}%  edge ${edge.padStart(5)}pp  ` +
        `cov ${(r.coverage * 100).toFixed(0)}% (n=${r.n})  ` +
        `| P&L exp ${r.pnl.expectancy.toFixed(3)}% PF ${r.pnl.profitFactor.toFixed(2)} ` +
        `win ${(r.pnl.winRate * 100).toFixed(0)}% avgR ${r.pnl.avgR.toFixed(3)} DD ${(r.pnl.maxDrawdown * 100).toFixed(1)}% (trades=${r.pnl.total})`
      );
    }
    console.log('\n  5d per-indicator OOS hit-rate (signal sign vs actual up):');
    for (const [k, v] of Object.entries(indicatorStats).sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total))) {
      if (v.total < 20) continue;
      console.log(`    ${k.padEnd(16)} ${(v.correct / v.total * 100).toFixed(1)}%  (n=${v.total})`);
    }
  }

  return results;
}

runEval();
