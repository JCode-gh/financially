import cron from 'node-cron';
import { getDB } from '../db/database.js';
import { evaluatePredictions } from './predictionEvaluator.js';
import { runBacktest } from './backtester.js';
import { runScan } from './scanner.js';
import { warmHistoryBatch, getSymbolsReadyForScan } from './historyWarmer.js';
import { withLock, markJob } from '../lib/jobLock.js';
import { logger } from '../lib/logger.js';

function run(name, fn) {
  return withLock(name, async () => {
    logger.info(`[Job] ${name} started`);
    const result = await fn();
    logger.info(`[Job] ${name} finished`);
    return result;
  }).catch(err => {
    logger.error(`[Job] ${name} failed: ${err.message}`);
  });
}

export function startScheduler() {
  cron.schedule('0 21 * * 1-5', () => {
    run('evaluate', () => evaluatePredictions());
  });

  cron.schedule('*/15 13-21 * * 1-5', () => {
    run('scan', () => runScan());
  });
  cron.schedule('0 12 * * 1-5', () => {
    run('scan', () => runScan());
  });

  cron.schedule('0 3 * * 0', () => {
    run('backtest', () => runBacktest(getSymbolsReadyForScan()));
  });

  cron.schedule('0 */2 * * 1-5', () => {
    run('warm', () => warmHistoryBatch());
  });

  setTimeout(() => run('warm', () => warmHistoryBatch({ log: true })), 3000);
  setTimeout(() => run('evaluate', () => evaluatePredictions()), 5000);

  setTimeout(async () => {
    try {
      const db = getDB();
      const { iteration } = db.prepare('SELECT iteration FROM model_weights WHERE name = ?').get('global') || {};
      const trained = db.prepare('SELECT COUNT(*) as n FROM backtest_results WHERE total > 0').get();
      if ((iteration || 0) < 500 || !trained?.n) {
        logger.info('[Job] Model is young — running walk-forward training');
        await run('backtest', () => runBacktest(getSymbolsReadyForScan()));
      }
    } catch (err) {
      logger.error(`[Job] startup backtest: ${err.message}`);
    }
    await run('scan', () => runScan());
    markJob('startup', { ok: true });
  }, 9000);
}
