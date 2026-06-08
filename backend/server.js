import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { initDB } from './db/database.js';
import newsRoutes from './routes/news.js';
import stockRoutes from './routes/stocks.js';
import predictionRoutes from './routes/predictions.js';
import { evaluatePredictions } from './jobs/predictionEvaluator.js';
import { initLiveStream } from './services/liveStream.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api/news', newsRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/predictions', predictionRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    apis: {
      finnhub: !!process.env.FINNHUB_API_KEY,
      newsApi: !!process.env.NEWS_API_KEY,
      alphaVantage: !!process.env.ALPHA_VANTAGE_KEY
    }
  });
});

// Evaluate predictions daily at 9 PM UTC (after US market close)
cron.schedule('0 21 * * 1-5', () => {
  console.log('[CRON] Running daily prediction evaluator...');
  evaluatePredictions().catch(console.error);
});

// Also run at startup to catch any missed evaluations (e.g. server was down)
setTimeout(() => {
  evaluatePredictions().catch(console.error);
}, 5000);

initDB();
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Financially backend running on http://localhost:${PORT}`);
  console.log(`   API health: http://localhost:${PORT}/api/health`);
  console.log(`   Finnhub: ${process.env.FINNHUB_API_KEY ? '✅' : '❌ (add FINNHUB_API_KEY to .env)'}`);
  console.log(`   NewsAPI: ${process.env.NEWS_API_KEY ? '✅' : '❌ (add NEWS_API_KEY to .env)'}`);
});

// Attach the live trade-tick WebSocket proxy to the same HTTP server
initLiveStream(server);
