// P&L-oriented metrics for backtest evaluation.

export const DEFAULT_COST_BPS = 10; // commission + slippage per round trip

/**
 * Simulate a directional trade: enter at entryPrice, exit at exitPrice.
 * Returns net return % after round-trip costs.
 */
export function tradeReturnPct(direction, entryPrice, exitPrice, costBps = DEFAULT_COST_BPS) {
  if (!entryPrice || !exitPrice) return 0;
  const raw = direction > 0
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
  return raw - (costBps / 100);
}

/**
 * R-multiple given entry, stop, exit (positive = win in R terms).
 */
export function tradeRMultiple(direction, entry, stop, exit) {
  const risk = Math.abs(entry - stop);
  if (!risk) return 0;
  const pnl = direction > 0 ? exit - entry : entry - exit;
  return pnl / risk;
}

/**
 * Aggregate a list of trade records into summary metrics.
 * Each trade: { returnPct, rMultiple? }
 */
export function aggregateTradeMetrics(trades) {
  if (!trades?.length) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      expectancy: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      avgR: 0,
      maxDrawdown: 0,
      sharpeLike: 0
    };
  }

  const returns = trades.map(t => t.returnPct ?? 0);
  const wins = trades.filter(t => (t.returnPct ?? 0) > 0);
  const losses = trades.filter(t => (t.returnPct ?? 0) <= 0);
  const grossWin = wins.reduce((s, t) => s + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.returnPct, 0));
  const winRate = wins.length / trades.length;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  const rMultiples = trades.map(t => t.rMultiple).filter(r => r != null && !Number.isNaN(r));
  const avgR = rMultiples.length ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;

  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance) || 1;
  const sharpeLike = mean / std;

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: parseFloat(winRate.toFixed(4)),
    expectancy: parseFloat(expectancy.toFixed(4)),
    profitFactor: parseFloat(Math.min(profitFactor, 99).toFixed(4)),
    avgWin: parseFloat(avgWin.toFixed(4)),
    avgLoss: parseFloat(avgLoss.toFixed(4)),
    avgR: parseFloat(avgR.toFixed(4)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(4)),
    sharpeLike: parseFloat(sharpeLike.toFixed(4))
  };
}
