import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { initDB, getDB } from './db/database.js';
import newsRoutes from './routes/news.js';
import stockRoutes from './routes/stocks.js';
import predictionRoutes from './routes/predictions.js';
import scannerRoutes from './routes/scanner.js';
import { evaluatePredictions } from './jobs/predictionEvaluator.js';
import { runBacktest } from './jobs/backtester.js';
import { runScan, SCAN_SYMBOLS } from './jobs/scanner.js';
import { initLiveStream } from './services/liveStream.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/news', newsRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/predictions', predictionRoutes);
app.use('/api/scanner', scannerRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    apis: {
      finnhub: !!process.env.FINNHUB_API_KEY,
      newsApi: !!process.env.NEWS_API_KEY,
      alphaVantage: !!process.env.ALPHA_VANTAGE_KEY,
      twelveData: !!process.env.TWELVE_DATA_KEY
    }
  });
});

// Evaluate predictions daily at 9 PM UTC (after US market close)
cron.schedule('0 21 * * 1-5', () => {
  console.log('[CRON] Running daily prediction evaluator...');
  evaluatePredictions().catch(console.error);
});

// Opportunity scanner: every 15 min through US market hours (13-21 UTC covers
// both DST regimes), plus one pre-market sweep so the board is fresh at the open.
cron.schedule('*/15 13-21 * * 1-5', () => {
  runScan().catch(err => console.error('[Scanner]', err.message));
});
cron.schedule('0 12 * * 1-5', () => {
  runScan().catch(err => console.error('[Scanner]', err.message));
});

// Weekly walk-forward re-train (Sunday night) keeps weights current as regimes shift
cron.schedule('0 3 * * 0', () => {
  runBacktest(SCAN_SYMBOLS).catch(err => console.error('[Backtest]', err.message));
});

initDB();

// Startup sequence (staggered so the first page load isn't competing for quota):
// 1. resolve any predictions that came due while the server was down
// 2. train the model over cached history if it's still young
// 3. run an immediate scan so the dashboard has opportunities right away
setTimeout(() => {
  evaluatePredictions().catch(console.error);
}, 5000);

setTimeout(async () => {
  try {
    const db = getDB();
    const { iteration } = db.prepare('SELECT iteration FROM model_weights WHERE name = ?').get('global') || {};
    const trained = db.prepare('SELECT COUNT(*) as n FROM backtest_results WHERE total > 0').get();
    if ((iteration || 0) < 500 || !trained?.n) {
      console.log('[Backtest] Model is young — running walk-forward training...');
      await runBacktest(SCAN_SYMBOLS);
    }
  } catch (err) {
    console.error('[Backtest]', err.message);
  }
  runScan().catch(err => console.error('[Scanner]', err.message));
}, 9000);

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Financially backend running on http://localhost:${PORT}`);
  console.log(`   API health: http://localhost:${PORT}/api/health`);
  console.log(`   Finnhub: ${process.env.FINNHUB_API_KEY ? '✅' : '❌ (add FINNHUB_API_KEY to .env)'}`);
  console.log(`   NewsAPI: ${process.env.NEWS_API_KEY ? '✅' : '❌ (add NEWS_API_KEY to .env)'}`);
  console.log(`   Twelve Data: ${process.env.TWELVE_DATA_KEY ? '✅' : '❌ (add TWELVE_DATA_KEY to .env)'}`);
});

// Attach the live trade-tick WebSocket proxy to the same HTTP server
initLiveStream(server);
