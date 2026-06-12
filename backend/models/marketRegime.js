// Market regime overlay: SPY trend + VIX level dampen long/short signals in risk-off tape.

import { getHistoricalSeries } from '../services/historyProvider.js';

let cache = { data: null, ts: 0 };
const TTL = 15 * 60_000;

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

async function fetchRegime() {
  const [spyCandles, vixCandles] = await Promise.all([
    getHistoricalSeries('SPY', 260, TTL).catch(() => null),
    getHistoricalSeries('^VIX', 30, TTL).catch(() => null)
  ]);

  let spyTrend = 0; // -1 bear, 0 neutral, 1 bull
  let vixLevel = 'normal';
  let label = 'neutral';

  if (spyCandles?.length >= 200) {
    const closes = spyCandles.map(c => c.close);
    const price = closes[closes.length - 1];
    const sma200 = calcSMA(closes, 200);
    const sma50 = calcSMA(closes, 50);
    if (sma200 && price > sma200 * 1.01 && sma50 > sma200) {
      spyTrend = 1;
      label = 'risk-on';
    } else if (sma200 && price < sma200 * 0.99 && sma50 < sma200) {
      spyTrend = -1;
      label = 'risk-off';
    }
  }

  if (vixCandles?.length >= 5) {
    const vix = vixCandles[vixCandles.length - 1].close;
    if (vix >= 28) { vixLevel = 'high'; label = label === 'risk-on' ? 'caution' : 'risk-off'; }
    else if (vix >= 20) vixLevel = 'elevated';
    else if (vix <= 14) vixLevel = 'low';
  }

  return { spyTrend, vixLevel, label, fetchedAt: Date.now() };
}

export async function getMarketRegime() {
  if (cache.data && Date.now() - cache.ts < TTL) return cache.data;
  try {
    cache = { data: await fetchRegime(), ts: Date.now() };
  } catch {
    if (!cache.data) cache.data = { spyTrend: 0, vixLevel: 'normal', label: 'neutral' };
  }
  return cache.data;
}

/**
 * Adjust composite score based on market-wide regime.
 * Dampens longs in risk-off, shorts in strong risk-on with low VIX.
 */
export function applyMarketRegime(composite, regime) {
  if (!regime) return composite;
  let adj = composite;

  if (regime.spyTrend === -1 && adj > 0) adj *= 0.72;
  if (regime.vixLevel === 'high' && adj > 0) adj *= 0.78;
  if (regime.spyTrend === 1 && regime.vixLevel === 'low' && adj < 0) adj *= 0.80;

  return Math.max(-1, Math.min(1, adj));
}
