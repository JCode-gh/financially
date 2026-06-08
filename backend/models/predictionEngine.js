import { getDB } from '../db/database.js';
import { computeAllIndicators, generateSignals } from './technicalAnalysis.js';
import { analyzeArticles } from './sentimentAnalyzer.js';

const LEARNING_RATE = 0.015;
const PREDICTION_THRESHOLDS = { strong: 0.35, moderate: 0.18 };

// ATR-scaled expected move + price target for a horizon (in trading days).
function horizonTarget(days, score, price, atr) {
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

// Plain-English reasoning behind a call.
function buildRationale(trend, indicators, direction) {
  const parts = [trend.label];
  if (indicators.macd) parts.push(indicators.macd.histogram >= 0 ? 'MACD rising' : 'MACD falling');
  if (indicators.rsi != null) {
    const r = Math.round(indicators.rsi);
    if (indicators.rsi > 70) parts.push(`RSI ${r} (hot)`);
    else if (indicators.rsi < 30) parts.push(`RSI ${r} (oversold)`);
    else parts.push(`RSI ${r}`);
  }
  if (indicators.volumeSignal > 0) parts.push('volume confirming');
  else if (indicators.volumeSignal < 0) parts.push('volume diverging');
  const dirWord = direction > 0 ? 'bullish' : direction < 0 ? 'bearish' : 'range-bound';
  return `${parts.join(' · ')} → ${dirWord}`;
}

export function getModelWeights() {
  const db = getDB();
  const row = db.prepare('SELECT weights, iteration FROM model_weights WHERE name = ?').get('global');
  return {
    weights: JSON.parse(row.weights),
    iteration: row.iteration
  };
}

export function saveModelWeights(weights, iteration) {
  const db = getDB();
  db.prepare(`
    UPDATE model_weights SET weights = ?, iteration = ?, updated_at = CURRENT_TIMESTAMP
    WHERE name = 'global'
  `).run(JSON.stringify(weights), iteration);
}

export function computeEnsembleScore(signals, weights) {
  let score = 0;
  let totalWeight = 0;
  for (const [indicator, signal] of Object.entries(signals)) {
    if (weights[indicator] !== undefined && signal !== undefined) {
      score += weights[indicator] * signal;
      totalWeight += weights[indicator];
    }
  }
  return totalWeight > 0 ? score / totalWeight : 0;
}

export function scoreToPrediction(score) {
  if (score >= PREDICTION_THRESHOLDS.strong) return { prediction: 'UP', confidence: Math.min(0.95, 0.6 + score * 0.5) };
  if (score >= PREDICTION_THRESHOLDS.moderate) return { prediction: 'UP', confidence: 0.55 + score * 0.3 };
  if (score <= -PREDICTION_THRESHOLDS.strong) return { prediction: 'DOWN', confidence: Math.min(0.95, 0.6 + Math.abs(score) * 0.5) };
  if (score <= -PREDICTION_THRESHOLDS.moderate) return { prediction: 'DOWN', confidence: 0.55 + Math.abs(score) * 0.3 };
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

export async function generatePredictions(ticker, candles, articles = []) {
  const db = getDB();
  const { weights, iteration } = getModelWeights();

  const indicators = computeAllIndicators(candles);
  const technicalSignals = generateSignals(indicators);

  // News sentiment signal
  const newsSentiment = analyzeArticles(articles);
  technicalSignals.news_sentiment = newsSentiment.score;

  // Trend-aware adjustment: in a strong trend, damp counter-trend oscillators
  // (e.g. an "overbought" RSI in a strong uptrend should not force a SELL/NEUTRAL).
  const trend = indicators.trend || { direction: 0, strength: 0, label: 'n/a' };
  const adjustedSignals = { ...technicalSignals };
  if (trend.strength > 0.5 && trend.direction !== 0) {
    for (const k of ['rsi', 'bollinger']) {
      if (adjustedSignals[k] != null && Math.sign(adjustedSignals[k]) === -trend.direction) {
        adjustedSignals[k] *= 0.3;
      }
    }
  }

  // Decisive blend: trend-following backbone (55%) + self-learning technical ensemble (45%),
  // with a conviction gain so genuine signals clear the thresholds instead of averaging to ~0.
  const technicalScore = computeEnsembleScore(adjustedSignals, weights);
  const trendScore = trend.direction * trend.strength;
  let score = 0.55 * trendScore + 0.45 * technicalScore;
  score = Math.max(-1, Math.min(1, score * 1.6));

  const price = indicators.price;
  const atr = indicators.atr || price * 0.02;
  const today = new Date().toISOString().split('T')[0];
  const direction = score >= PREDICTION_THRESHOLDS.moderate ? 1
    : score <= -PREDICTION_THRESHOLDS.moderate ? -1 : 0;
  const rationale = buildRationale(trend, indicators, direction);

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
    const tgt = horizonTarget(days, score, price, atr);
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

    const { prediction, confidence } = scoreToPrediction(score);
    const targetDate = addTradingDays(today, days);

    const result = insert.run(
      ticker, targetDate, id, prediction,
      parseFloat(confidence.toFixed(4)),
      parseFloat(score.toFixed(6)),
      price,
      JSON.stringify(adjustedSignals),
      JSON.stringify(weights)
    );
    predictions.push({ id: result.lastInsertRowid, ticker, horizon: id, prediction, confidence, score, targetDate, ...enrich });
  }

  return {
    ticker,
    predictions,
    signals: adjustedSignals,
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
      atr: indicators.atr ? parseFloat(indicators.atr.toFixed(2)) : null,
      price: indicators.price
    },
    trend: { label: trend.label, direction: trend.direction, strength: parseFloat((trend.strength || 0).toFixed(2)) },
    newsSentiment: {
      score: parseFloat(newsSentiment.score.toFixed(3)),
      label: newsSentiment.label
    },
    weights,
    modelIteration: iteration
  };
}

// Self-learning weight update using perceptron-style online learning
export function updateWeightsFromOutcome(signals, wasCorrect, predictionScore) {
  const { weights, iteration } = getModelWeights();
  const updatedWeights = { ...weights };

  const direction = predictionScore >= 0 ? 1 : -1;

  for (const [indicator, weight] of Object.entries(updatedWeights)) {
    const signal = signals[indicator];
    if (signal === undefined || signal === 0) continue;

    const signalDirection = signal * direction;
    // If correct: reinforce the signal that contributed; if wrong: weaken it
    const delta = wasCorrect
      ? LEARNING_RATE * Math.abs(signal)
      : -LEARNING_RATE * Math.abs(signal);

    updatedWeights[indicator] = Math.max(0.02, weight + delta);
  }

  // Normalize so weights sum to 1
  const total = Object.values(updatedWeights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(updatedWeights)) {
    updatedWeights[key] = parseFloat((updatedWeights[key] / total).toFixed(6));
  }

  saveModelWeights(updatedWeights, iteration + 1);
  return updatedWeights;
}
