// Gradually warm disk history cache for universe symbols within free API quotas.

import { readHistory } from '../services/historyProvider.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { getScanUniverse, CORE_SCAN_SYMBOLS } from '../data/universe.js';

const MIN_BARS = 260;
const BATCH_SIZE = parseInt(process.env.HISTORY_WARM_BATCH || '12', 10);
const STATE = { lastRun: 0, cursor: 0 };

export function getSymbolsReadyForScan(minBars = MIN_BARS) {
  const universe = getScanUniverse();
  const ready = [];
  for (const sym of universe) {
    const disk = readHistory(sym);
    if (disk?.candles?.length >= minBars) ready.push(sym);
  }
  // Always include core symbols even if cache thin (scanner will try live fetch)
  for (const sym of CORE_SCAN_SYMBOLS) {
    if (!ready.includes(sym)) ready.push(sym);
  }
  return [...new Set(ready)];
}

export async function warmHistoryBatch({ batchSize = BATCH_SIZE, log = true } = {}) {
  const universe = getScanUniverse();
  const needWarm = universe.filter(sym => {
    const disk = readHistory(sym);
    return !disk?.candles?.length || disk.candles.length < MIN_BARS;
  });

  if (!needWarm.length) {
    if (log) console.log(`[HistoryWarmer] All ${universe.length} symbols have sufficient cache.`);
    return { warmed: 0, ready: getSymbolsReadyForScan().length };
  }

  const batch = [];
  for (let i = 0; i < batchSize && needWarm.length; i++) {
    const idx = (STATE.cursor + i) % needWarm.length;
    batch.push(needWarm[idx]);
  }
  STATE.cursor = (STATE.cursor + batchSize) % Math.max(needWarm.length, 1);

  let warmed = 0;
  for (const sym of batch) {
    try {
      const candles = await getHistoricalSeries(sym, 500, 0);
      if (candles?.length >= 60) warmed++;
      await new Promise(r => setTimeout(r, 350));
    } catch { /* skip */ }
  }

  STATE.lastRun = Date.now();
  const ready = getSymbolsReadyForScan().length;
  if (log) console.log(`[HistoryWarmer] Warmed ${warmed}/${batch.length} symbols · ${ready} ready for scan`);
  return { warmed, batch: batch.length, ready, pending: needWarm.length - warmed };
}

export function getWarmerStatus() {
  const universe = getScanUniverse();
  const ready = getSymbolsReadyForScan().length;
  return {
    universeSize: universe.length,
    readyForScan: ready,
    coveragePct: parseFloat((ready / universe.length * 100).toFixed(1)),
    lastRun: STATE.lastRun || null
  };
}
