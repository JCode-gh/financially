// Confidence calibration: map stated confidence to measured hit-rate.

import { getDB } from '../db/database.js';

export const CALIBRATION_BUCKETS = [
  { low: 0.50, high: 0.55 },
  { low: 0.55, high: 0.60 },
  { low: 0.60, high: 0.65 },
  { low: 0.65, high: 0.70 },
  { low: 0.70, high: 0.75 },
  { low: 0.75, high: 0.80 },
  { low: 0.80, high: 0.85 },
  { low: 0.85, high: 1.00 }
];

function bucketFor(confidence) {
  for (const b of CALIBRATION_BUCKETS) {
    if (confidence >= b.low && confidence < b.high) return b;
  }
  return CALIBRATION_BUCKETS[CALIBRATION_BUCKETS.length - 1];
}

export function recalculateCalibration(horizon = '5d') {
  const db = getDB();
  const rows = db.prepare(`
    SELECT confidence, correct FROM predictions
    WHERE horizon = ? AND correct IS NOT NULL AND prediction != 'NEUTRAL'
  `).all(horizon);

  const buckets = {};
  for (const b of CALIBRATION_BUCKETS) {
    buckets[`${b.low}`] = { total: 0, correct: 0 };
  }

  for (const r of rows) {
    const b = bucketFor(r.confidence ?? 0.5);
    const key = `${b.low}`;
    buckets[key].total++;
    if (r.correct === 1) buckets[key].correct++;
  }

  const upsert = db.prepare(`
    INSERT INTO calibration (horizon, bucket_low, bucket_high, total, correct, hit_rate, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(horizon, bucket_low) DO UPDATE SET
      total = excluded.total, correct = excluded.correct,
      hit_rate = excluded.hit_rate, updated_at = CURRENT_TIMESTAMP
  `);

  const curve = [];
  for (const b of CALIBRATION_BUCKETS) {
    const key = `${b.low}`;
    const s = buckets[key];
    const hitRate = s.total > 0 ? s.correct / s.total : null;
    upsert.run(horizon, b.low, b.high, s.total, s.correct, hitRate ?? 0);
    curve.push({
      bucketLow: b.low,
      bucketHigh: b.high,
      total: s.total,
      correct: s.correct,
      hitRate,
      midpoint: (b.low + b.high) / 2
    });
  }
  return curve;
}

export function getCalibrationCurve(horizon = '5d') {
  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM calibration WHERE horizon = ? ORDER BY bucket_low
  `).all(horizon);
  return rows.map(r => ({
    bucketLow: r.bucket_low,
    bucketHigh: r.bucket_high,
    total: r.total,
    correct: r.correct,
    hitRate: r.total > 0 ? r.hit_rate : null,
    midpoint: (r.bucket_low + r.bucket_high) / 2
  }));
}

/**
 * Remap raw heuristic confidence to measured win probability.
 * Falls back to raw confidence when bucket has insufficient samples.
 */
export function calibratedWinProbability(rawConfidence, horizon = '5d', minSamples = 8) {
  const curve = getCalibrationCurve(horizon);
  const b = bucketFor(rawConfidence ?? 0.5);
  const row = curve.find(c => c.bucketLow === b.low);
  if (row?.total >= minSamples && row.hitRate != null) {
    return row.hitRate;
  }
  // Interpolate from populated buckets or fall back
  const populated = curve.filter(c => c.total >= minSamples && c.hitRate != null);
  if (populated.length >= 2) {
    const sorted = [...populated].sort((a, b) => a.midpoint - b.midpoint);
    if (rawConfidence <= sorted[0].midpoint) return sorted[0].hitRate;
    if (rawConfidence >= sorted[sorted.length - 1].midpoint) return sorted[sorted.length - 1].hitRate;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b2 = sorted[i + 1];
      if (rawConfidence >= a.midpoint && rawConfidence <= b2.midpoint) {
        const t = (rawConfidence - a.midpoint) / (b2.midpoint - a.midpoint);
        return a.hitRate + t * (b2.hitRate - a.hitRate);
      }
    }
  }
  return rawConfidence ?? 0.5;
}
