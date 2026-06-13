import { getDB, DEFAULT_WEIGHTS } from '../db/database.js';
import { computeAllIndicators, generateSignals } from './technicalAnalysis.js';
import { analyzeArticles } from './sentimentAnalyzer.js';
import { applyWeightHygiene } from './signalHygiene.js';
import { calibratedWinProbability } from './calibration.js';

const LEARNING_RATE = 0.015;
// Per-horizon action thresholds, set where the walk-forward calibration curve
// shows a real edge (top-quartile conviction). Below `moderate` the honest
// answer is NEUTRAL — no edge, no call.
const PREDICTION_THRESHOLDS = {
  '1d':  { moderate: 0.30, strong: 0.45 },
  '5d':  { moderate: 0.20, strong: 0.32 },
  '30d': { moderate: 0.45, strong: 0.70 }
};

// ATR-scaled expected move + price target for a horizon (in trading days).
export function horizonTarget(days, score, price, atr) {
  const dir = score >= 0 ? 1 : -1;
  const conviction = Math.min(1, Math.abs(score));
  const atrPct = atr / price;
  const expectedMove = atrPct * Math.sqrt(days) * (0.5 + 0.9 * conviction) * dir;
  const band = atrPct * Math.sqrt(days);
  return {
    expectedMovePct: expectedMove * 100,
    targetPrice: price * (1 + expectedMove),
    low: price * (1 + expectedMove - band),
    high: price * (1 + expectedMove + band)
  };
}

// ATR stop/target multipliers that grow with the intended hold time so the
// plan doesn't get stopped out by normal intraday noise on longer trades.
function atrMultsForDays(maxDays) {
  if (maxDays <= 2)  return { stop: 1.0, target: 1.5 }; // day / scalp
  if (maxDays <= 5)  return { stop: 1.4, target: 2.1 }; // short swing
  if (maxDays <= 10) return { stop: 1.8, target: 2.7 }; // medium swing
  if (maxDays <= 20) return { stop: 2.2, target: 3.3 }; // swing
  return              { stop: 2.8, target: 4.2 };        // position
}

// Variant of buildTradePlan that scales stops/targets for a user-chosen hold window.
export function buildTradePlanForDays(direction, indicators, maxDays) {
  const price = indicators.price;
  const atr = indicators.atr || price * 0.02;
  const { sr } = indicators;
  if (!direction || !price) return null;

  const { stop: sM, target: tM } = atrMultsForDays(maxDays);
  let entry = price, stop, target, stopBasis = 'ATR', targetBasis = 'ATR';

  if (direction > 0) {
    stop = price - sM * atr;
    if (sr?.support && price - sr.support.price < sM * 1.5 * atr && sr.support.price < price) {
      stop = Math.min(stop, sr.support.price * 0.99);
      stopBasis = `support $${sr.support.price.toFixed(2)}`;
    }
    target = price + tM * atr;
    if (sr?.resistance && sr.resistance.price - price < tM * 1.5 * atr && sr.resistance.price > price * 1.01) {
      target = sr.resistance.price * 0.998;
      targetBasis = `resistance $${sr.resistance.price.toFixed(2)}`;
    }
  } else {
    stop = price + sM * atr;
    if (sr?.resistance && sr.resistance.price - price < sM * 1.5 * atr && sr.resistance.price > price) {
      stop = Math.max(stop, sr.resistance.price * 1.01);
      stopBasis = `resistance $${sr.resistance.price.toFixed(2)}`;
    }
    target = price - tM * atr;
    if (sr?.support && price - sr.support.price < tM * 1.5 * atr && sr.support.price < price * 0.99) {
      target = sr.support.price * 1.002;
      targetBasis = `support $${sr.support.price.toFixed(2)}`;
    }
  }

  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr     = risk > 0 ? reward / risk : 0;
  const riskPct = (risk / entry) * 100;
  const positionPct = riskPct > 0 ? Math.min(25, Math.round(100 / riskPct)) : 0;

  return {
    direction:   direction > 0 ? 'LONG' : 'SHORT',
    entry:       parseFloat(entry.toFixed(2)),
    stop:        parseFloat(stop.toFixed(2)),
    target:      parseFloat(target.toFixed(2)),
    rr:          parseFloat(rr.toFixed(2)),
    riskPct:     parseFloat(riskPct.toFixed(2)),
    positionPct,
    stopBasis,
    targetBasis,
    maxDays
  };
}

// Concrete trade plan: entry, stop (ATR- and support/resistance-aware), target,
// risk/reward, and a position-size suggestion for a 1%-of-account risk budget.
export function buildTradePlan(direction, indicators, { confidence, rr: rrOverride } = {}) {
  const price = indicators.price;
  const atr = indicators.atr || price * 0.02;
  const { sr } = indicators;
  if (!direction || !price) return null;

  let entry = price, stop, target, stopBasis = 'ATR', targetBasis = 'ATR';

  if (direction > 0) {
    stop = price - 1.6 * atr;
    if (sr?.support && price - sr.support.price < 2.5 * atr && sr.support.price < price) {
      stop = Math.min(stop, sr.support.price * 0.99); // just below support
      stopBasis = `support $${sr.support.price.toFixed(2)}`;
    }
    target = price + 2.4 * atr;
    if (sr?.resistance && sr.resistance.price - price < 5 * atr && sr.resistance.price > price * 1.01) {
      target = sr.resistance.price * 0.998; // just below resistance
      targetBasis = `resistance $${sr.resistance.price.toFixed(2)}`;
    }
  } else {
    stop = price + 1.6 * atr;
    if (sr?.resistance && sr.resistance.price - price < 2.5 * atr && sr.resistance.price > price) {
      stop = Math.max(stop, sr.resistance.price * 1.01); // just above resistance
      stopBasis = `resistance $${sr.resistance.price.toFixed(2)}`;
    }
    target = price - 2.4 * atr;
    if (sr?.support && price - sr.support.price < 5 * atr && sr.support.price < price * 0.99) {
      target = sr.support.price * 1.002;
      targetBasis = `support $${sr.support.price.toFixed(2)}`;
    }
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = rrOverride ?? (risk > 0 ? reward / risk : 0);
  const riskPct = (risk / entry) * 100;

  // Base: 1% account risk cap → position size
  let positionPct = riskPct > 0 ? Math.min(25, Math.round(100 / riskPct)) : 0;

  // Edge-based Kelly tilt (capped at quarter-Kelly)
  if (confidence != null && rr > 0) {
    const p = calibratedWinProbability(confidence, '5d');
    const kelly = (p * rr - (1 - p)) / rr;
    const kellyFrac = Math.max(0, Math.min(0.25, kelly * 0.25));
    const kellyScale = 0.75 + kellyFrac * 2;
    positionPct = Math.min(25, Math.round(positionPct * kellyScale));
  }

  return {
    direction: direction > 0 ? 'LONG' : 'SHORT',
    entry: parseFloat(entry.toFixed(2)),
    stop: parseFloat(stop.toFixed(2)),
    target: parseFloat(target.toFixed(2)),
    rr: parseFloat(rr.toFixed(2)),
    riskPct: parseFloat(riskPct.toFixed(2)),
    positionPct,
    stopBasis,
    targetBasis
  };
}

// Human-readable reasons behind a call — ranked, specific, no jargon walls.
export function buildReasons(indicators, signals, newsSentiment, direction) {
  const reasons = [];
  const { trend, rsi, macd, adx, stochastic, mfi, week52, maCross, breakout, sr } = indicators;

  if (trend?.direction) {
    const adxTxt = adx?.adx != null ? ` (ADX ${Math.round(adx.adx)})` : '';
    reasons.push({ w: trend.strength * 1.2, text: `${trend.label}${adxTxt}` });
  }
  if (maCross?.golden) reasons.push({ w: 1.4, text: 'Golden cross — SMA50 crossed above SMA200' });
  if (maCross?.death) reasons.push({ w: 1.4, text: 'Death cross — SMA50 crossed below SMA200' });
  if (macd?.crossed_above) reasons.push({ w: 1.1, text: 'MACD bullish cross today' });
  else if (macd?.crossed_below) reasons.push({ w: 1.1, text: 'MACD bearish cross today' });
  else if (macd) reasons.push({ w: 0.4, text: macd.histogram >= 0 ? 'MACD momentum rising' : 'MACD momentum falling' });

  if (rsi != null) {
    if (rsi >= 75) reasons.push({ w: 0.9, text: `RSI ${Math.round(rsi)} — overbought` });
    else if (rsi <= 25) reasons.push({ w: 0.9, text: `RSI ${Math.round(rsi)} — oversold` });
    else reasons.push({ w: 0.2, text: `RSI ${Math.round(rsi)}` });
  }
  if (breakout?.type === 'up') reasons.push({ w: 1.0, text: 'Breakout above 20-day high' + (breakout.signal === 1 ? ' on heavy volume' : '') });
  if (breakout?.type === 'down') reasons.push({ w: 1.0, text: 'Breakdown below 20-day low' + (breakout.signal === -1 ? ' on heavy volume' : '') });
  if (week52) {
    if (week52.position > 0.95) reasons.push({ w: 0.7, text: 'Trading at 52-week highs' });
    else if (week52.position < 0.08) reasons.push({ w: 0.7, text: 'Near 52-week lows' });
  }
  if (stochastic && signals.stochastic != null && Math.abs(signals.stochastic) >= 1) {
    reasons.push({ w: 0.8, text: signals.stochastic > 0 ? 'Stochastic bullish cross from oversold' : 'Stochastic bearish cross from overbought' });
  }
  if (mfi != null && (mfi < 20 || mfi > 80)) {
    reasons.push({ w: 0.6, text: mfi < 20 ? `Money flow washed out (MFI ${Math.round(mfi)})` : `Money flow stretched (MFI ${Math.round(mfi)})` });
  }
  if (signals.volume_trend != null && Math.abs(signals.volume_trend) > 0.5) {
    reasons.push({ w: 0.6, text: signals.volume_trend > 0 ? 'Volume confirms buyers in control' : 'Volume shows distribution' });
  }
  if (newsSentiment && Math.abs(newsSentiment.score) > 0.15) {
    const evTxt = newsSentiment.topEvents?.length
      ? ` — ${newsSentiment.topEvents.slice(0, 2).map(e => e.label).join(', ')}`
      : '';
    reasons.push({ w: 0.9 + Math.abs(newsSentiment.score), text: `News ${newsSentiment.label}${evTxt}` });
  }
  if (sr?.resistance && direction > 0 && (sr.resistance.price - indicators.price) / indicators.price < 0.02) {
    reasons.push({ w: 0.8, text: `Resistance overhead at $${sr.resistance.price.toFixed(2)}` });
  }
  if (sr?.support && direction < 0 && (indicators.price - sr.support.price) / indicators.price < 0.02) {
    reasons.push({ w: 0.8, text: `Support nearby at $${sr.support.price.toFixed(2)}` });
  }

  return reasons.sort((a, b) => b.w - a.w).slice(0, 6).map(r => r.text);
}

export function getModelWeights(name = 'global') {
  const db = getDB();
  const row = db.prepare('SELECT weights, iteration FROM model_weights WHERE name = ?').get(name)
    || db.prepare('SELECT weights, iteration FROM model_weights WHERE name = ?').get('global');
  if (!row) return { weights: { ...DEFAULT_WEIGHTS }, iteration: 0 };
  return {
    weights: JSON.parse(row.weights),
    iteration: row.iteration
  };
}

// One weight set per horizon — each is trained against its own forward return,
// because what predicts tomorrow (mean reversion) differs from what predicts
// next month (trend/drift).
export function getHorizonWeights() {
  return {
    '1d': getModelWeights('h1d'),
    '5d': getModelWeights('h5d'),
    '30d': getModelWeights('h30d')
  };
}

export function saveModelWeights(weights, iteration, name = 'global') {
  const db = getDB();
  db.prepare(`
    UPDATE model_weights SET weights = ?, iteration = ?, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(JSON.stringify(weights), iteration, name);
  // 'global' mirrors the 5d set (the app's swing anchor) for anything legacy
  if (name === 'h5d') {
    db.prepare(`
      UPDATE model_weights SET weights = ?, iteration = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = 'global'
    `).run(JSON.stringify(weights), iteration);
  }
}

// Weights are SIGNED: a negative weight means the model has learned that, in
// the current market regime, this signal works as a contrarian indicator
// (e.g. fading momentum in a choppy market). Normalized by total |weight|.
export function computeEnsembleScore(signals, weights) {
  const w = applyWeightHygiene(weights);
  let score = 0;
  let totalWeight = 0;
  for (const [indicator, signal] of Object.entries(signals)) {
    if (w[indicator] !== undefined && signal !== undefined) {
      score += w[indicator] * signal;
      totalWeight += Math.abs(w[indicator]);
    }
  }
  return totalWeight > 0 ? score / totalWeight : 0;
}

export function scoreToPrediction(score, horizon = '5d') {
  const t = PREDICTION_THRESHOLDS[horizon] || PREDICTION_THRESHOLDS['5d'];
  const a = Math.abs(score);
  if (a >= t.strong) {
    return { prediction: score > 0 ? 'UP' : 'DOWN', confidence: Math.min(0.85, 0.62 + (a - t.strong) * 0.3) };
  }
  if (a >= t.moderate) {
    return { prediction: score > 0 ? 'UP' : 'DOWN', confidence: 0.55 + (a - t.moderate) / (t.strong - t.moderate) * 0.07 };
  }
  return { prediction: 'NEUTRAL', confidence: 0.5 };
}

function addTradingDays(dateStr, days) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

// Per-horizon drift: equity markets drift upward (~8-10%/yr), so absent
// bearish evidence longer horizons lean UP — that's the base rate, not optimism.
export const HORIZON_BLEND = {
  '1d':  { drift: 0.012 },
  '5d':  { drift: 0.030 },
  '30d': { drift: 0.060 }
};

// The score is the learned ensemble + drift, with a conviction gain so genuine
// agreement clears the action thresholds. No hard-coded trend backbone: the
// trend regime votes as a weighted signal like everything else, and the
// walk-forward learning decides how much it deserves in the current market.
export function blendForHorizon(technicalScore, horizon) {
  const b = HORIZON_BLEND[horizon] || HORIZON_BLEND['5d'];
  const s = technicalScore + b.drift;
  return Math.max(-1, Math.min(1, s * 1.7));
}

// Signal components, shared by live predictions, the scanner, and the
// backtester (so they always agree). Weight-independent.
export function computeSignalSet(candles, newsScore = null) {
  const indicators = computeAllIndicators(candles);
  const signals = generateSignals(indicators);
  if (newsScore != null) signals.news_sentiment = newsScore;
  const trend = indicators.trend || { direction: 0, strength: 0, label: 'n/a' };
  return { signals, indicators, trend };
}

// Returns the 5d blend as `score` (the app's swing-trading anchor) plus all
// per-horizon scores, each computed from its own trained weight set.
export function computeScore(candles, horizonWeights, newsScore = null) {
  const { signals, indicators, trend } = computeSignalSet(candles, newsScore);

  const scores = {};
  for (const h of ['1d', '5d', '30d']) {
    const w = horizonWeights[h]?.weights || horizonWeights[h] || {};
    scores[h] = blendForHorizon(computeEnsembleScore(signals, w), h);
  }

  return {
    score: scores['5d'],
    scores,
    trendScore: trend.direction * trend.strength,
    indicators,
    signals,
    trend
  };
}

export async function generatePredictions(ticker, candles, articles = []) {
  const db = getDB();
  const horizonWeights = getHorizonWeights();
  const { weights, iteration } = horizonWeights['5d'];

  // News sentiment + event impact for this ticker
  const newsSentiment = analyzeArticles(articles, ticker);

  const { score, scores, indicators, signals: adjustedSignals, trend } = computeScore(candles, horizonWeights, newsSentiment.score);

  const price = indicators.price;
  const atr = indicators.atr || price * 0.02;
  const today = new Date().toISOString().split('T')[0];
  const t5 = PREDICTION_THRESHOLDS['5d'];
  const direction = score >= t5.moderate ? 1 : score <= -t5.moderate ? -1 : 0;
  const reasons = buildReasons(indicators, adjustedSignals, newsSentiment, direction);
  const rationale = reasons.slice(0, 3).join(' · ');
  const tradePlan = direction !== 0 ? buildTradePlan(direction, indicators, { confidence: scoreToPrediction(score, '5d').confidence }) : null;

  const horizons = [
    { id: '1d', days: 1 },
    { id: '5d', days: 5 },
    { id: '30d', days: 30 }
  ];

  const predictions = [];
  const insert = db.prepare(`
    INSERT INTO predictions
      (ticker, predicted_at, target_date, horizon, prediction, confidence, score, price_at_prediction, signals, weights_used)
    VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const { id, days } of horizons) {
    const hScore = scores[id] ?? score;
    const tgt = horizonTarget(days, hScore, price, atr);
    const enrich = {
      expectedMovePct: parseFloat(tgt.expectedMovePct.toFixed(2)),
      targetPrice: parseFloat(tgt.targetPrice.toFixed(2)),
      low: parseFloat(tgt.low.toFixed(2)),
      high: parseFloat(tgt.high.toFixed(2)),
      rationale
    };

    // Reuse today's stored prediction (the persisted record the evaluator scores),
    // but always attach fresh targets/rationale for display.
    const existing = db.prepare(`
      SELECT id, prediction, confidence, score, target_date FROM predictions
      WHERE ticker = ? AND horizon = ? AND date(predicted_at) = date('now')
        AND correct IS NULL
    `).get(ticker, id);
    if (existing) {
      predictions.push({
        id: existing.id, ticker, horizon: id,
        prediction: existing.prediction, confidence: existing.confidence,
        score: existing.score, targetDate: existing.target_date, ...enrich
      });
      continue;
    }

    const { prediction, confidence } = scoreToPrediction(hScore, id);
    const targetDate = addTradingDays(today, days);

    const result = insert.run(
      ticker, targetDate, id, prediction,
      parseFloat(confidence.toFixed(4)),
      parseFloat(hScore.toFixed(6)),
      price,
      JSON.stringify(adjustedSignals),
      JSON.stringify(horizonWeights[id]?.weights || weights)
    );
    predictions.push({ id: result.lastInsertRowid, ticker, horizon: id, prediction, confidence, score: hScore, targetDate, ...enrich });
  }

  return {
    ticker,
    predictions,
    signals: adjustedSignals,
    tradePlan,
    reasons,
    indicators: {
      rsi: indicators.rsi ? parseFloat(indicators.rsi.toFixed(2)) : null,
      macd: indicators.macd ? {
        value: parseFloat(indicators.macd.macd.toFixed(4)),
        signal: parseFloat(indicators.macd.signal.toFixed(4)),
        histogram: parseFloat(indicators.macd.histogram.toFixed(4))
      } : null,
      bb: indicators.bb ? {
        upper: parseFloat(indicators.bb.upper.toFixed(2)),
        middle: parseFloat(indicators.bb.middle.toFixed(2)),
        lower: parseFloat(indicators.bb.lower.toFixed(2)),
        pctB: parseFloat(indicators.bb.pctB.toFixed(3))
      } : null,
      sma20: indicators.sma20 ? parseFloat(indicators.sma20.toFixed(2)) : null,
      sma50: indicators.sma50 ? parseFloat(indicators.sma50.toFixed(2)) : null,
      sma200: indicators.sma200 ? parseFloat(indicators.sma200.toFixed(2)) : null,
      atr: indicators.atr ? parseFloat(indicators.atr.toFixed(2)) : null,
      adx: indicators.adx ? parseFloat(indicators.adx.adx.toFixed(1)) : null,
      stochK: indicators.stochastic ? parseFloat(indicators.stochastic.k.toFixed(1)) : null,
      mfi: indicators.mfi != null ? parseFloat(indicators.mfi.toFixed(1)) : null,
      week52Position: indicators.week52 ? parseFloat(indicators.week52.position.toFixed(3)) : null,
      support: indicators.sr?.support ? parseFloat(indicators.sr.support.price.toFixed(2)) : null,
      resistance: indicators.sr?.resistance ? parseFloat(indicators.sr.resistance.price.toFixed(2)) : null,
      price: indicators.price
    },
    trend: { label: trend.label, direction: trend.direction, strength: parseFloat((trend.strength || 0).toFixed(2)) },
    newsSentiment: {
      score: parseFloat(newsSentiment.score.toFixed(3)),
      label: newsSentiment.label,
      impactPct: newsSentiment.impactPct,
      buzz: newsSentiment.buzz,
      topEvents: newsSentiment.topEvents,
      articleCount: newsSentiment.articleCount
    },
    weights,
    modelIteration: iteration
  };
}

// Self-learning weight update from a realized forward return (live evaluator
// path). Each horizon's weight set learns only from its own horizon's outcomes.
export function updateWeightsFromReturn(signals, priceChangePct, horizon = '5d') {
  const name = { '1d': 'h1d', '5d': 'h5d', '30d': 'h30d' }[horizon] || 'h5d';
  const { weights, iteration } = getModelWeights(name);
  const updatedWeights = applyReturnToWeights(weights, signals, priceChangePct);
  saveModelWeights(updatedWeights, iteration + 1, name);
  return updatedWeights;
}

// Hebbian return-correlation learning (pure, no DB — shared with the backtester):
//   w_i += lr × signal_i × clamp(forwardReturn)
// Each signal's weight tracks its CURRENT correlation with forward returns.
// A signal that keeps pointing the wrong way doesn't just shrink — it goes
// NEGATIVE, so the ensemble automatically fades it until the regime turns.
// No assumptions about which regime we're in; the data decides.
export function applyReturnToWeights(weights, signals, fwdReturnPct, learningRate = LEARNING_RATE) {
  const updatedWeights = { ...weights };
  // ±1.5% forward move saturates the teaching signal (robust to gaps/crashes)
  const target = Math.max(-1, Math.min(1, fwdReturnPct / 1.5));

  for (const [indicator, weight] of Object.entries(updatedWeights)) {
    const signal = signals[indicator];
    if (signal === undefined || signal === 0) continue;
    updatedWeights[indicator] = weight + learningRate * signal * target;
  }

  // Cap any single |weight| at 0.30 (no monoculture), normalize Σ|w| = 1.
  for (const key of Object.keys(updatedWeights)) {
    updatedWeights[key] = Math.max(-0.30, Math.min(0.30, updatedWeights[key]));
  }
  const total = Object.values(updatedWeights).reduce((a, b) => a + Math.abs(b), 0);
  if (total > 0) {
    for (const key of Object.keys(updatedWeights)) {
      updatedWeights[key] = parseFloat((updatedWeights[key] / total).toFixed(6));
    }
  }
  return updatedWeights;
}

export { PREDICTION_THRESHOLDS };
