// Fundamental signals from Finnhub metrics — live-only (no historical backtest).

import { getBasicFinancials } from '../services/finnhub.js';

function clamp(v, lo = -1, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function growthSignal(val) {
  if (val == null || Number.isNaN(val)) return 0;
  if (val > 0.25) return 1;
  if (val > 0.10) return 0.6;
  if (val > 0) return 0.2;
  if (val < -0.15) return -0.8;
  if (val < 0) return -0.3;
  return 0;
}

function valuationSignal(pe, pb) {
  let s = 0;
  if (pe != null) {
    if (pe < 12) s += 0.5;
    else if (pe < 20) s += 0.1;
    else if (pe > 45) s -= 0.6;
    else if (pe > 30) s -= 0.3;
  }
  if (pb != null) {
    if (pb < 1.5) s += 0.3;
    else if (pb > 8) s -= 0.4;
  }
  return clamp(s);
}

function qualitySignal(roe, currentRatio, debtToEquity) {
  let s = 0;
  if (roe != null) {
    if (roe > 0.20) s += 0.5;
    else if (roe > 0.12) s += 0.2;
    else if (roe < 0.05) s -= 0.4;
  }
  if (currentRatio != null && currentRatio < 1) s -= 0.3;
  if (debtToEquity != null && debtToEquity > 2) s -= 0.3;
  return clamp(s);
}

/**
 * Post-earnings drift: recent beat + gap up → bullish drift signal.
 */
export function earningsDriftSignal(candles, earnings) {
  if (!candles?.length || !earnings) return 0;
  const days = earnings.daysUntil;
  // Only signal in 0-5 days AFTER earnings (daysUntil negative or just reported)
  if (days == null || days > 0 || days < -5) return 0;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return 0;

  const gapPct = ((last.open - prev.close) / prev.close) * 100;
  const dayMove = ((last.close - last.open) / last.open) * 100;

  if (gapPct > 2 && dayMove > 0) return clamp(0.5 + gapPct / 20);
  if (gapPct < -2 && dayMove < 0) return clamp(-0.5 + gapPct / 20);
  if (Math.abs(gapPct) > 1) return gapPct > 0 ? 0.3 : -0.3;
  return 0;
}

export async function getFundamentalSignals(ticker, candles, earnings) {
  const fin = await getBasicFinancials(ticker).catch(() => null);
  const signals = {
    valuation: 0,
    growth: 0,
    quality: 0,
    earnings_drift: earningsDriftSignal(candles, earnings)
  };

  if (fin) {
    signals.growth = growthSignal(fin.epsGrowth ?? fin.revenueGrowth);
    signals.valuation = valuationSignal(fin.peRatioTTM, fin.priceToBook);
    signals.quality = qualitySignal(fin.roeTTM, fin.currentRatio, fin.debtToEquity);
  }

  return { signals, fin };
}

export function mergeFundamentalSignals(baseSignals, fundSignals) {
  return { ...baseSignals, ...fundSignals };
}
