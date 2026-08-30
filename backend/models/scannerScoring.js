import { PREDICTION_THRESHOLDS } from './predictionEngine.js';
import { applyMarketRegime } from './marketRegime.js';
import { MIN_UNIVERSE_FOR_RANK, TOP_DECILE, BOTTOM_DECILE } from './signalHygiene.js';

export const SCAN_GATES = {
  action: PREDICTION_THRESHOLDS['5d'].strong,
  minConfidence: 0.58,
  minRR: 1.5,
  minADX: 18,
  newsWeight: 0.14
};

export function applyRegimeAdjustment(composite, indicators, marketRegime = null) {
  let adjusted = composite;
  const adx = indicators.adx?.adx;
  const trendDir = indicators.trend?.direction ?? 0;

  if (adx != null && adx < SCAN_GATES.minADX) adjusted *= 0.62;
  if (adjusted > 0.12 && trendDir < -0.35) adjusted *= 0.72;
  if (adjusted < -0.12 && trendDir > 0.35) adjusted *= 0.72;

  if (marketRegime) adjusted = applyMarketRegime(adjusted, marketRegime);

  return Math.max(-1, Math.min(1, adjusted));
}

export function classifyPick({
  composite, confidence, tradePlan, indicators, earnings,
  crossPercentile, universeSize
}) {
  const abs = Math.abs(composite);
  const rawSignal = composite >= PREDICTION_THRESHOLDS['5d'].moderate ? 'BUY'
    : composite <= -PREDICTION_THRESHOLDS['5d'].moderate ? 'SELL'
    : 'NEUTRAL';

  const flags = [];
  let actionable = false;
  let quality = 'hold';

  if (rawSignal === 'NEUTRAL') {
    return { action: 'HOLD', rawSignal, actionable, quality, flags, rank: abs * confidence * 10 };
  }

  const direction = rawSignal === 'BUY' ? 1 : -1;
  const passesScore = abs >= SCAN_GATES.action;
  const passesConf = confidence >= SCAN_GATES.minConfidence;
  const passesRR = tradePlan && tradePlan.rr >= SCAN_GATES.minRR;
  const earningsOk = !(earnings?.daysUntil >= 0 && earnings?.daysUntil <= 1);
  const adx = indicators.adx?.adx;
  const trendDir = indicators.trend?.direction ?? 0;
  const trendAligned = direction > 0 ? trendDir >= -0.25 : trendDir <= 0.25;
  const chop = adx != null && adx < SCAN_GATES.minADX;

  let passesRank = true;
  if (universeSize >= MIN_UNIVERSE_FOR_RANK && crossPercentile != null) {
    if (direction > 0) passesRank = crossPercentile >= TOP_DECILE;
    else passesRank = crossPercentile <= BOTTOM_DECILE;
  }

  if (!passesScore) flags.push('Score below strong threshold');
  if (!passesConf) flags.push('Low confidence');
  if (!passesRR) flags.push(tradePlan ? `R:R ${tradePlan.rr?.toFixed(1)} below ${SCAN_GATES.minRR}` : 'No trade plan');
  if (!earningsOk) flags.push('Earnings within 1 day');
  if (!trendAligned) flags.push('Against prevailing trend');
  if (chop) flags.push('Choppy market (low ADX)');
  if (!passesRank) flags.push(`Not in top/bottom decile (rank ${crossPercentile?.toFixed(0)}%)`);

  actionable = passesScore && passesConf && passesRR && earningsOk && trendAligned && !chop && passesRank;

  if (actionable) {
    quality = abs >= 0.48 ? 'high' : 'medium';
  } else if (abs >= PREDICTION_THRESHOLDS['5d'].moderate) {
    quality = 'watch';
  } else {
    quality = 'low';
  }

  const action = actionable ? rawSignal : 'HOLD';
  const rank = (actionable ? 100 : quality === 'watch' ? 35 : 0)
    + abs * 40
    + confidence * 25
    + (tradePlan?.rr || 0) * 5
    + (crossPercentile != null ? Math.abs(crossPercentile - 50) * 0.3 : 0);

  return { action, rawSignal, actionable, quality, flags, rank };
}

const GENERIC_SIGNAL_KEYS = new Set([
  'stochastic', 'rsi', 'macd', 'sma_crossover', 'ema_crossover', 'bollinger', 'adx_trend'
]);

const GENERIC_REASON_RE = /^(Stochastic|RSI|MACD|SMA crossover|EMA crossover|Bollinger|Trend strength|Price momentum|Trend regime|Volume trend|News context)\b|^(uptrend|downtrend|strong uptrend|strong downtrend)\b|^MACD momentum|^RSI \d+$/i;

export function isGenericPickReason(text) {
  return GENERIC_REASON_RE.test(String(text || '').replace(/\s*\(weight[^)]*\)/gi, '').trim());
}

export function specificPickReason(indicators, direction) {
  if (!indicators) return '';
  const { sr, week52, rsi, breakout } = indicators;
  if (direction > 0 && breakout?.type === 'up') {
    return 'Breakout above 20-day high' + (breakout.signal === 1 ? ' on heavy volume' : '');
  }
  if (direction < 0 && breakout?.type === 'down') {
    return 'Breakdown below 20-day low' + (breakout.signal === -1 ? ' on heavy volume' : '');
  }
  if (direction > 0 && sr?.support?.price) {
    return `Holding above support at $${Number(sr.support.price).toFixed(2)}`;
  }
  if (direction < 0 && sr?.resistance?.price) {
    return `Capped by resistance at $${Number(sr.resistance.price).toFixed(2)}`;
  }
  if (week52?.position != null) {
    return `Trading at ${Math.round(week52.position * 100)}% of its 52-week range`;
  }
  if (rsi != null) return `RSI ${Math.round(rsi)}`;
  return '';
}

export function assemblePickReasons({
  narrativeReasons = [], weightedReasons = [], earnings, indicators, direction
} = {}) {
  const out = [];
  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 7) {
    out.push(`Earnings ${earnings.daysUntil === 0 ? 'TODAY' : `in ${earnings.daysUntil}d`}`);
  }
  const specific = specificPickReason(indicators, direction);
  if (specific) out.push(specific);
  for (const reason of [...narrativeReasons, ...weightedReasons]) {
    const line = String(reason || '').trim();
    if (!line || isGenericPickReason(line) || out.includes(line)) continue;
    out.push(line);
  }
  return out.slice(0, 5);
}

export function buildWeightedReasons(signals, weights, newsSentiment) {
  if (!signals || !weights) return [];
  const entries = [];
  for (const [key, sig] of Object.entries(signals)) {
    if (sig == null || Math.abs(sig) < 0.05) continue;
    if (GENERIC_SIGNAL_KEYS.has(key) && Math.abs(sig) < 0.9) continue;
    const w = weights[key] ?? 0;
    const contrib = sig * w;
    if (Math.abs(contrib) < 0.02) continue;
    entries.push({ key, contrib: Math.abs(contrib), text: formatSignalReason(key, sig, contrib) });
  }
  if (newsSentiment && Math.abs(newsSentiment.score) > 0.12) {
    entries.push({
      key: 'news',
      contrib: Math.abs(newsSentiment.score) * (weights.news_sentiment ?? 0.10),
      text: `News context (${newsSentiment.label})${newsSentiment.buzz > 1.5 ? ' — elevated coverage' : ''}`
    });
  }
  return entries.sort((a, b) => b.contrib - a.contrib).slice(0, 4).map(e => e.text);
}

function formatSignalReason(key, sig, contrib) {
  const dir = sig > 0 ? 'bullish' : 'bearish';
  const labels = {
    momentum: 'Price momentum',
    trend_regime: 'Trend regime',
    sma_crossover: 'SMA crossover',
    ema_crossover: 'EMA crossover',
    breakout: 'Breakout pattern',
    adx_trend: 'Trend strength (ADX)',
    volume_trend: 'Volume trend',
    macd: 'MACD',
    rsi: 'RSI',
    stochastic: 'Stochastic',
    bollinger: 'Bollinger bands',
    mfi: 'Money flow',
    news_sentiment: 'News context',
    valuation: 'Valuation',
    growth: 'Growth',
    quality: 'Quality',
    earnings_drift: 'Post-earnings drift'
  };
  const label = labels[key] || key.replace(/_/g, ' ');
  return `${label} ${dir} (weight ${(contrib * 100).toFixed(0)}%)`;
}
