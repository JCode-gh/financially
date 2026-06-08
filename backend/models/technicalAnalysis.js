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

  return {
    macd,
    signal,
    histogram: macd - signal,
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

// Trend regime from moving-average structure + SMA50 slope.
// Returns { direction: -1|0|1, strength: 0..1, slope, label }.
export function calcTrendRegime(candles) {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  if (sma20 == null || sma50 == null) return { direction: 0, strength: 0, slope: 0, label: 'insufficient data' };
  const sma50Prev = calcSMA(closes.slice(0, -10), 50);
  const slope = sma50Prev != null && sma50Prev !== 0 ? (sma50 - sma50Prev) / sma50Prev : 0;

  let score = 0;
  score += price > sma20 ? 1 : -1;
  score += sma20 > sma50 ? 1 : -1;
  score += price > sma50 ? 1 : -1;
  score += slope > 0.002 ? 1 : slope < -0.002 ? -1 : 0; // score ∈ [-4, 4]

  const direction = score > 0 ? 1 : score < 0 ? -1 : 0;
  const strength = Math.min(1, Math.abs(score) / 4);
  const label = direction > 0 ? (strength > 0.6 ? 'strong uptrend' : 'uptrend')
    : direction < 0 ? (strength > 0.6 ? 'strong downtrend' : 'downtrend')
    : 'sideways / range-bound';
  return { direction, strength, slope, label };
}

export function calcVolumeSignal(candles) {
  if (candles.length < 20) return 0;
  const recent = candles.slice(-20);
  const avgVolume = recent.reduce((a, c) => a + c.volume, 0) / 20;
  const lastVolume = candles[candles.length - 1].volume;
  const lastClose = candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2].close;
  const priceUp = lastClose > prevClose;
  const volumeRatio = lastVolume / avgVolume;

  // High volume with price up = bullish, high volume with price down = bearish
  if (volumeRatio > 1.5) return priceUp ? 1 : -1;
  if (volumeRatio > 1.2) return priceUp ? 0.5 : -0.5;
  return 0;
}

export function computeAllIndicators(candles) {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollingerBands(closes);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const price = closes[closes.length - 1];
  const volumeSignal = calcVolumeSignal(candles);
  const atr = calcATR(candles);
  const trend = calcTrendRegime(candles);

  return { rsi, macd, bb, sma20, sma50, ema12, ema26, price, volumeSignal, atr, trend };
}

// Generate signals [-1 to 1] for each indicator
export function generateSignals(indicators) {
  const { rsi, macd, bb, sma20, sma50, ema12, ema26, price, volumeSignal } = indicators;
  const signals = {};

  // RSI signal: <30 = strong buy, 30-40 = buy, 60-70 = sell, >70 = strong sell
  if (rsi !== null) {
    if (rsi < 25) signals.rsi = 1;
    else if (rsi < 35) signals.rsi = 0.7;
    else if (rsi < 45) signals.rsi = 0.3;
    else if (rsi < 55) signals.rsi = 0;
    else if (rsi < 65) signals.rsi = -0.3;
    else if (rsi < 75) signals.rsi = -0.7;
    else signals.rsi = -1;
  }

  // MACD signal
  if (macd !== null) {
    if (macd.crossed_above) signals.macd = 1;
    else if (macd.crossed_below) signals.macd = -1;
    else signals.macd = macd.histogram > 0 ? Math.min(1, macd.histogram * 10) : Math.max(-1, macd.histogram * 10);
  }

  // SMA crossover
  if (sma20 !== null && sma50 !== null) {
    const diff = (sma20 - sma50) / sma50;
    signals.sma_crossover = Math.max(-1, Math.min(1, diff * 20));
    // Strong crossover signals
    if (price > sma20 && sma20 > sma50) signals.sma_crossover = Math.min(1, signals.sma_crossover + 0.3);
    if (price < sma20 && sma20 < sma50) signals.sma_crossover = Math.max(-1, signals.sma_crossover - 0.3);
  }

  // EMA crossover
  if (ema12 !== null && ema26 !== null) {
    const diff = (ema12 - ema26) / ema26;
    signals.ema_crossover = Math.max(-1, Math.min(1, diff * 20));
  }

  // Bollinger Bands: %B < 0 = oversold, > 1 = overbought
  if (bb !== null) {
    if (bb.pctB < 0) signals.bollinger = 1;
    else if (bb.pctB < 0.2) signals.bollinger = 0.6;
    else if (bb.pctB < 0.4) signals.bollinger = 0.2;
    else if (bb.pctB < 0.6) signals.bollinger = 0;
    else if (bb.pctB < 0.8) signals.bollinger = -0.2;
    else if (bb.pctB <= 1) signals.bollinger = -0.6;
    else signals.bollinger = -1;
  }

  // Volume trend
  signals.volume_trend = volumeSignal;

  return signals;
}
