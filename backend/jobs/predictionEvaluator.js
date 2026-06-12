import { getDB } from '../db/database.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { updateWeightsFromReturn } from '../models/predictionEngine.js';

export async function evaluatePredictions() {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];

  // Find all unresolved predictions where target_date has passed
  const pending = db.prepare(`
    SELECT * FROM predictions
    WHERE correct IS NULL AND target_date <= ?
    ORDER BY ticker, target_date
  `).all(today);

  if (pending.length === 0) {
    console.log('[Evaluator] No pending predictions to resolve.');
    return { resolved: 0 };
  }

  console.log(`[Evaluator] Resolving ${pending.length} predictions...`);
  let resolved = 0;

  // Group by ticker to minimize API calls
  const byTicker = {};
  pending.forEach(p => {
    if (!byTicker[p.ticker]) byTicker[p.ticker] = [];
    byTicker[p.ticker].push(p);
  });

  const update = db.prepare(`
    UPDATE predictions SET
      resolved_at = CURRENT_TIMESTAMP,
      actual_price = ?,
      correct = ?,
      price_change_pct = ?
    WHERE id = ?
  `);

  for (const [ticker, preds] of Object.entries(byTicker)) {
    try {
      // Multi-source provider (Twelve Data → Yahoo → Stooq → AV → disk cache).
      // Only resolve against real market data — skip (retry next run) if unavailable.
      const candles = await getHistoricalSeries(ticker, 60).catch(() => null);
      if (!candles || candles.length === 0) continue;

      const priceMap = {};
      candles.forEach(c => { priceMap[c.date] = c.close; });

      for (const pred of preds) {
        // Find the closest available price to target_date
        let actualPrice = priceMap[pred.target_date];
        if (!actualPrice) {
          // Try nearby dates (market may have been closed)
          for (let offset = 1; offset <= 5; offset++) {
            const d = new Date(pred.target_date);
            d.setDate(d.getDate() - offset);
            const dateStr = d.toISOString().split('T')[0];
            if (priceMap[dateStr]) { actualPrice = priceMap[dateStr]; break; }
          }
        }
        if (!actualPrice) continue;

        const priceChangePct = ((actualPrice - pred.price_at_prediction) / pred.price_at_prediction) * 100;
        const actualWentUp = actualPrice > pred.price_at_prediction;
        const wasCorrect =
          (pred.prediction === 'UP' && actualWentUp) ||
          (pred.prediction === 'DOWN' && !actualWentUp) ||
          (pred.prediction === 'NEUTRAL' && Math.abs(priceChangePct) < 1);

        update.run(actualPrice, wasCorrect ? 1 : 0, priceChangePct, pred.id);

        // Update this horizon's model weights from the realized forward return
        try {
          const signals = JSON.parse(pred.signals);
          updateWeightsFromReturn(signals, priceChangePct, pred.horizon);
        } catch { /* skip weight update if signals are malformed */ }

        resolved++;
        console.log(`[Evaluator] ${ticker} ${pred.horizon}: ${pred.prediction} → ${wasCorrect ? '✓' : '✗'} (${priceChangePct.toFixed(2)}%)`);
      }
    } catch (err) {
      console.error(`[Evaluator] Failed to evaluate ${ticker}:`, err.message);
    }
  }

  // Recompute accuracy metrics
  recalculateAccuracy();

  console.log(`[Evaluator] Done. Resolved ${resolved} predictions.`);
  return { resolved };
}

function recalculateAccuracy() {
  const db = getDB();
  const horizons = ['1d', '5d', '30d'];

  for (const horizon of horizons) {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct
      FROM predictions
      WHERE horizon = ? AND correct IS NOT NULL
    `).get(horizon);

    const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;

    db.prepare(`
      UPDATE accuracy_metrics
      SET total = ?, correct = ?, accuracy = ?, updated_at = CURRENT_TIMESTAMP
      WHERE horizon = ?
    `).run(stats.total, stats.correct, accuracy, horizon);
  }
}

export { recalculateAccuracy };
