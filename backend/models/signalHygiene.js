// Cap combined weight of correlated trend-family signals to reduce redundancy.

const TREND_FAMILY = ['momentum', 'trend_regime', 'sma_crossover', 'ema_crossover'];
const TREND_FAMILY_CAP = 0.28;

export function applyWeightHygiene(weights) {
  if (!weights) return weights;
  const w = { ...weights };

  const familyAbs = TREND_FAMILY.reduce((s, k) => s + Math.abs(w[k] ?? 0), 0);
  if (familyAbs > TREND_FAMILY_CAP && familyAbs > 0) {
    const scale = TREND_FAMILY_CAP / familyAbs;
    for (const k of TREND_FAMILY) {
      if (w[k] != null) w[k] = w[k] * scale;
    }
  }

  const total = Object.values(w).reduce((a, b) => a + Math.abs(b), 0);
  if (total > 0) {
    for (const k of Object.keys(w)) {
      w[k] = parseFloat((w[k] / total).toFixed(6));
    }
  }
  return w;
}

/**
 * Compute cross-sectional percentile ranks for composite scores.
 * Returns Map<ticker, { rank, percentile }> (1 = best bullish rank).
 */
export function rankCrossSectionally(results) {
  if (!results?.length) return new Map();

  const sorted = [...results].sort((a, b) => b.composite - a.composite);
  const n = sorted.length;
  const map = new Map();

  sorted.forEach((r, i) => {
    const percentile = n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 50;
    map.set(r.ticker, {
      crossRank: i + 1,
      crossPercentile: parseFloat(percentile.toFixed(1))
    });
  });

  return map;
}

export const MIN_UNIVERSE_FOR_RANK = 20;
export const TOP_DECILE = 90;
export const BOTTOM_DECILE = 10;
