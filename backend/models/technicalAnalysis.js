// Technical analysis indicators. All functions accept an array of candles
// sorted oldest-first: [{ close, high, low, volume, date }, ...]

export function calcSMA(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export function calcEMAFull(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  const recent = changes.slice(-period * 2);
  let avgGain = 0, avgLoss = 0;
  const initial = recent.slice(0, period);
  initial.forEach(c => {
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  });
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < recent.length; i++) {
    const change = recent[i];
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calcMACD(closes) {
  if (closes.length < 35) return null;
  const ema12Series = calcEMAFull(closes, 12);
  const ema26Series = calcEMAFull(closes, 26);
  const offset = ema12Series.length - ema26Series.length;

  const macdLine = ema26Series.map((ema26, i) => ema12Series[i + offset] - ema26);
  const signalLine = calcEMAFull(macdLine, 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  const prevMacd = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];
  const histogram = macd - signal;

  return {
    macd,
    signal,
    histogram,
    prevHistogram: prevMacd - prevSignal,
    crossed_above: prevMacd < prevSignal && macd > signal,
    crossed_below: prevMacd > prevSignal && macd < signal
  };
}

export function calcBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = sma + stdDevMultiplier * stdDev;
  const lower = sma - stdDevMultiplier * stdDev;
  const price = closes[closes.length - 1];
  const pctB = (price - lower) / (upper - lower);

  return { upper, middle: sma, lower, pctB, stdDev };
}

// Average True Range — volatility measure used to scale price targets.
export function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const recent = trs.slice(-period * 3);
  let atr = recent.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < recent.length; i++) {
    atr = (atr * (period - 1) + recent[i]) / period; // Wilder smoothing
  }
  return atr;
}

// ADX with +DI/-DI (Wilder). Measures trend STRENGTH (0-100) and direction.
// ADX > 25 = trending market, < 20 = choppy. Critical for knowing when
// trend-following signals are trustworthy vs when to fade extremes.
export function calcADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const window = candles.slice(-(period * 3 + 1));

  const plusDM = [], minusDM = [], trs = [];
  for (let i = 1; i < window.length; i++) {
    const upMove = window[i].high - window[i - 1].high;
    const downMove = window[i - 1].low - window[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const h = window[i].high, l = window[i].low, pc = window[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // Wilder-smoothed sums
  const smooth = (arr) => {
    let s = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };

  const sTR = smooth(trs), sPlus = smooth(plusDM), sMinus = smooth(minusDM);
  const dxs = [];
  let plusDI = 0, minusDI = 0;
  for (let i = 0; i < sTR.length; i++) {
    if (!sTR[i]) { dxs.push(0); continue; }
    plusDI = (sPlus[i] / sTR[i]) * 100;
    minusDI = (sMinus[i] / sTR[i]) * 100;
    const sum = plusDI + minusDI;
    dxs.push(sum ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0);
  }
  if (dxs.length < period) return null;

  let adx = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dxs.length; i++) {
    adx = (adx * (period - 1) + dxs[i]) / period;
  }

  return { adx, plusDI, minusDI };
}

// Stochastic oscillator %K(14) smoothed by 3, %D = 3-SMA of %K.
export function calcStochastic(candles, kPeriod = 14, smooth = 3) {
  if (candles.length < kPeriod + smooth + 3) return null;
  const rawK = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const win = candles.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...win.map(c => c.high));
    const ll = Math.min(...win.map(c => c.low));
    rawK.push(hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100);
  }
  const smoothSeries = (arr, p) => {
    const out = [];
    for (let i = p - 1; i < arr.length; i++) {
      out.push(arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p);
    }
    return out;
  };
  const kSeries = smoothSeries(rawK, smooth);
  const dSeries = smoothSeries(kSeries, 3);
  return {
    k: kSeries[kSeries.length - 1],
    d: dSeries[dSeries.length - 1],
    prevK: kSeries[kSeries.length - 2],
    prevD: dSeries[dSeries.length - 2]
  };
}

// Money Flow Index — volume-weighted RSI. Detects buying/selling pressure.
export function calcMFI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const window = candles.slice(-(period + 1));
  let posFlow = 0, negFlow = 0;
  for (let i = 1; i < window.length; i++) {
    const tp = (window[i].high + window[i].low + window[i].close) / 3;
    const prevTp = (window[i - 1].high + window[i - 1].low + window[i - 1].close) / 3;
    const flow = tp * (window[i].volume || 0);
    if (tp > prevTp) posFlow += flow;
    else if (tp < prevTp) negFlow += flow;
  }
  if (negFlow === 0) return 100;
  return 100 - 100 / (1 + posFlow / negFlow);
}

// On-Balance Volume slope over the last `lookback` bars, normalized to [-1, 1].
// Rising OBV while price is flat = accumulation (smart money buying).
export function calcOBVTrend(candles, lookback = 20) {
  if (candles.length < lookback + 2) return 0;
  let obv = 0;
  const series = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume || 0;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume || 0;
    series.push(obv);
  }
  const recent = series.slice(-lookback);
  // Simple linear regression slope, normalized by mean absolute OBV step
  const n = recent.length;
  const xMean = (n - 1) / 2;
  const yMean = recent.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (recent[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den ? num / den : 0;
  const avgVol = candles.slice(-lookback).reduce((a, c) => a + (c.volume || 0), 0) / lookback;
  if (!avgVol) return 0;
  return Math.max(-1, Math.min(1, slope / (avgVol * 0.35)));
}

// Swing-pivot support/resistance levels from the last ~120 candles.
// Pivots within 1.5% of each other cluster into one level; more touches = stronger.
export function findSupportResistance(candles, lookback = 120, pivotWindow = 4) {
  const window = candles.slice(-lookback);
  if (window.length < pivotWindow * 2 + 5) return { support: null, resistance: null, levels: [] };
  const price = window[window.length - 1].close;

  const pivots = [];
  for (let i = pivotWindow; i < window.length - pivotWindow; i++) {
    const highs = window.slice(i - pivotWindow, i + pivotWindow + 1).map(c => c.high);
    const lows = window.slice(i - pivotWindow, i + pivotWindow + 1).map(c => c.low);
    if (window[i].high === Math.max(...highs)) pivots.push({ price: window[i].high, type: 'high' });
    if (window[i].low === Math.min(...lows)) pivots.push({ price: window[i].low, type: 'low' });
  }

  // Cluster pivots within 1.5%
  const levels = [];
  for (const p of pivots.sort((a, b) => a.price - b.price)) {
    const near = levels.find(l => Math.abs(l.price - p.price) / l.price < 0.015);
    if (near) {
      near.touches++;
      near.price = (near.price * (near.touches - 1) + p.price) / near.touches;
    } else {
      levels.push({ price: p.price, touches: 1 });
    }
  }

  const strong = levels.filter(l => l.touches >= 1).sort((a, b) => a.price - b.price);
  const support = [...strong].reverse().find(l => l.price < price * 0.998) || null;
  const resistance = strong.find(l => l.price > price * 1.002) || null;

  return {
    support: support ? { price: support.price, touches: support.touches } : null,
    resistance: resistance ? { price: resistance.price, touches: resistance.touches } : null,
    levels: strong.map(l => ({ price: parseFloat(l.price.toFixed(2)), touches: l.touches }))
  };
}

// Position within the 52-week range: 0 = at low, 1 = at high.
export function calc52WeekPosition(candles) {
  const window = candles.slice(-252);
  if (window.length < 60) return null;
  const high = Math.max(...window.map(c => c.high));
  const low = Math.min(...window.map(c => c.low));
  const price = window[window.length - 1].close;
  if (high === low) return null;
  return { position: (price - low) / (high - low), high, low };
}

// Golden cross (SMA50 crossing above SMA200) / death cross within the last few bars.
export function detectMACross(candles, fastP = 50, slowP = 200, withinBars = 5) {
  const closes = candles.map(c => c.close);
  if (closes.length < slowP + withinBars + 1) return { golden: false, death: false };
  const fastNow = calcSMA(closes, fastP);
  const slowNow = calcSMA(closes, slowP);
  const before = closes.slice(0, -withinBars);
  const fastPrev = calcSMA(before, fastP);
  const slowPrev = calcSMA(before, slowP);
  if ([fastNow, slowNow, fastPrev, slowPrev].some(v => v == null)) return { golden: false, death: false };
  return {
    golden: fastPrev <= slowPrev && fastNow > slowNow,
    death: fastPrev >= slowPrev && fastNow < slowNow
  };
}

// Breakout: close above the prior 20-day high (or below the 20-day low).
// Confirmed by above-average volume → stronger signal.
export function detectBreakout(candles, lookback = 20) {
  if (candles.length < lookback + 2) return { signal: 0, type: null };
  const prior = candles.slice(-(lookback + 1), -1);
  const last = candles[candles.length - 1];
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));
  const avgVol = prior.reduce((a, c) => a + (c.volume || 0), 0) / prior.length;
  const volBoost = avgVol > 0 && last.volume > avgVol * 1.4;

  if (last.close > priorHigh) return { signal: volBoost ? 1 : 0.6, type: 'up' };
  if (last.close < priorLow) return { signal: volBoost ? -1 : -0.6, type: 'down' };
  return { signal: 0, type: null };
}

// Trend regime: moving-average structure + SMA50 slope + ADX strength.
// Returns { direction: -1|0|1, strength: 0..1, slope, adx, label }.
export function calcTrendRegime(candles, adxData = null) {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  if (sma20 == null || sma50 == null) return { direction: 0, strength: 0, slope: 0, adx: null, label: 'insufficient data' };
  const sma50Prev = calcSMA(closes.slice(0, -10), 50);
  const slope = sma50Prev != null && sma50Prev !== 0 ? (sma50 - sma50Prev) / sma50Prev : 0;

  let score = 0;
  score += price > sma20 ? 1 : -1;
  score += sma20 > sma50 ? 1 : -1;
  score += price > sma50 ? 1 : -1;
  score += slope > 0.002 ? 1 : slope < -0.002 ? -1 : 0; // score ∈ [-4, 4]

  const direction = score > 0 ? 1 : score < 0 ? -1 : 0;
  let strength = Math.min(1, Math.abs(score) / 4);

  // Blend in ADX: a "trend" with ADX 15 is noise; with ADX 35 it's real.
  if (adxData?.adx != null) {
    const adxFactor = Math.min(1, adxData.adx / 40);
    strength = strength * 0.55 + adxFactor * 0.45;
    // DI disagreement with MA structure weakens conviction
    const diDir = adxData.plusDI > adxData.minusDI ? 1 : -1;
    if (direction !== 0 && diDir !== direction) strength *= 0.6;
  }

  const label = direction > 0 ? (strength > 0.6 ? 'strong uptrend' : 'uptrend')
    : direction < 0 ? (strength > 0.6 ? 'strong downtrend' : 'downtrend')
    : 'sideways / range-bound';
  return { direction, strength, slope, adx: adxData?.adx ?? null, label };
}

export function calcVolumeSignal(candles) {
  if (candles.length < 21) return 0;
  const recent = candles.slice(-20);
  const avgVolume = recent.reduce((a, c) => a + c.volume, 0) / 20;
  const lastVolume = candles[candles.length - 1].volume;
  const lastClose = candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2].close;
  const priceUp = lastClose > prevClose;
  const volumeRatio = avgVolume > 0 ? lastVolume / avgVolume : 1;

  // High volume with price up = bullish, high volume with price down = bearish
  let signal = 0;
  if (volumeRatio > 1.5) signal = priceUp ? 1 : -1;
  else if (volumeRatio > 1.2) signal = priceUp ? 0.5 : -0.5;

  // Blend with OBV accumulation/distribution trend
  const obv = calcOBVTrend(candles);
  return Math.max(-1, Math.min(1, signal * 0.6 + obv * 0.4));
}

// 6-month price momentum, skipping the most recent week (the classic 12-1 style
// momentum construction — recent-week returns tend to mean-revert).
export function calcMomentum(closes) {
  if (closes.length < 132) return null;
  const past = closes[closes.length - 127];
  const recentEx = closes[closes.length - 6];
  if (!past) return null;
  return (recentEx - past) / past;
}

export function computeAllIndicators(candles) {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollingerBands(closes);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const price = closes[closes.length - 1];
  const volumeSignal = calcVolumeSignal(candles);
  const atr = calcATR(candles);
  const adx = calcADX(candles);
  const stochastic = calcStochastic(candles);
  const mfi = calcMFI(candles);
  const trend = calcTrendRegime(candles, adx);
  const sr = findSupportResistance(candles);
  const week52 = calc52WeekPosition(candles);
  const maCross = detectMACross(candles);
  const breakout = detectBreakout(candles);
  const momentum = calcMomentum(closes);

  return {
    rsi, macd, bb, sma20, sma50, sma200, ema12, ema26, price, volumeSignal,
    atr, adx, stochastic, mfi, trend, sr, week52, maCross, breakout, momentum
  };
}

// Generate signals [-1 to 1] for each indicator
export function generateSignals(indicators) {
  const {
    rsi, macd, bb, sma20, sma50, ema12, ema26, price, volumeSignal,
    adx, stochastic, mfi, week52, maCross, breakout, momentum, trend
  } = indicators;
  const signals = {};

  // Trend regime as a learnable ensemble member: the model discovers for itself
  // how much MA-structure trend should count in the current market, instead of
  // a hard-coded backbone that wins in trends and bleeds in chop.
  if (trend) {
    signals.trend_regime = trend.direction * trend.strength;
  }

  // RSI: vote only at genuine extremes. Mid-range RSI has no edge, and treating
  // "overbought" as an automatic sell is anti-predictive in trending large caps —
  // measured directly on this app's own backtest data.
  if (rsi !== null) {
    if (rsi < 25) signals.rsi = 1;
    else if (rsi < 32) signals.rsi = 0.6;
    else if (rsi > 80) signals.rsi = -0.7;
    else if (rsi > 72) signals.rsi = -0.3;
    else signals.rsi = 0;
  }

  // MACD: crossover events plus histogram SLOPE (momentum building/fading).
  // The raw histogram level is stale through long trends.
  if (macd !== null) {
    if (macd.crossed_above) signals.macd = 1;
    else if (macd.crossed_below) signals.macd = -1;
    else {
      const slope = macd.histogram - (macd.prevHistogram ?? macd.histogram);
      signals.macd = Math.max(-0.7, Math.min(0.7, slope * 12));
    }
  }

  // SMA crossover
  if (sma20 !== null && sma50 !== null) {
    const diff = (sma20 - sma50) / sma50;
    signals.sma_crossover = Math.max(-1, Math.min(1, diff * 20));
    // Strong crossover signals
    if (price > sma20 && sma20 > sma50) signals.sma_crossover = Math.min(1, signals.sma_crossover + 0.3);
    if (price < sma20 && sma20 < sma50) signals.sma_crossover = Math.max(-1, signals.sma_crossover - 0.3);
    // Golden/death cross is a major structural event
    if (maCross?.golden) signals.sma_crossover = 1;
    if (maCross?.death) signals.sma_crossover = -1;
  }

  // EMA crossover
  if (ema12 !== null && ema26 !== null) {
    const diff = (ema12 - ema26) / ema26;
    signals.ema_crossover = Math.max(-1, Math.min(1, diff * 20));
  }

  // Bollinger: only band BREACHES vote. Below the lower band, snap-back edge is
  // real; above the upper band the fade edge is weak (bands-riding uptrends), so
  // the bearish vote is deliberately smaller.
  if (bb !== null) {
    if (bb.pctB < 0) signals.bollinger = 0.8;
    else if (bb.pctB > 1) signals.bollinger = -0.4;
    else signals.bollinger = 0;
  }

  // Volume trend (spike direction blended with OBV slope)
  signals.volume_trend = volumeSignal;

  // Stochastic: extreme-zone events only — mid-range %K carries no edge
  if (stochastic) {
    const { k, d, prevK, prevD } = stochastic;
    if (k < 20 && prevK <= prevD && k > d) signals.stochastic = 1;        // bullish cross in oversold zone
    else if (k > 80 && prevK >= prevD && k < d) signals.stochastic = -1;  // bearish cross in overbought zone
    else if (k < 15) signals.stochastic = 0.5;
    else if (k > 88) signals.stochastic = -0.4;
    else signals.stochastic = 0;
  }

  // ADX directional trend: strength × DI direction (trend-following signal)
  if (adx) {
    const dir = adx.plusDI > adx.minusDI ? 1 : -1;
    const strength = Math.min(1, Math.max(0, (adx.adx - 15) / 30)); // 0 below ADX 15, 1 at ADX 45
    signals.adx_trend = dir * strength;
  }

  // MFI: deep washouts only — moderate readings are noise
  if (mfi !== null) {
    if (mfi < 15) signals.mfi = 0.8;
    else if (mfi < 25) signals.mfi = 0.4;
    else if (mfi > 85) signals.mfi = -0.4;
    else if (mfi > 78) signals.mfi = -0.2;
    else signals.mfi = 0;
  }

  // Breakout of 20-day range + 52-week-high momentum
  let breakoutSignal = breakout?.signal || 0;
  if (week52) {
    // Near 52w high with momentum = strength (highs beget highs); near low = weakness
    if (week52.position > 0.95) breakoutSignal = Math.min(1, breakoutSignal + 0.4);
    else if (week52.position < 0.08) breakoutSignal = Math.max(-1, breakoutSignal - 0.4);
  }
  signals.breakout = Math.max(-1, Math.min(1, breakoutSignal));

  // 6-month momentum: ±20% move saturates the signal. The strongest measured
  // signal in this app's backtests (and the best-documented anomaly).
  if (momentum != null) {
    signals.momentum = Math.max(-1, Math.min(1, momentum * 5));
  }

  return signals;
}
