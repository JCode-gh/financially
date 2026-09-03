import express from 'express';
import cors from 'cors';
import { isAllowedOrigin, config } from './config.js';
import newsRoutes from './routes/news.js';
import stockRoutes from './routes/stocks.js';
import predictionRoutes from './routes/predictions.js';
import scannerRoutes from './routes/scanner.js';
import chatRoutes from './routes/chat.js';
import { getJobStatus, isLocked } from './lib/jobLock.js';
import { lastOllamaStatus, pingOllama } from './services/ollama.js';
import { notFound, errorHandler } from './lib/errors.js';

export function createApp() {
  const app = express();

  app.use(cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    }
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use('/api/news', newsRoutes);
  app.use('/api/stocks', stockRoutes);
  app.use('/api/predictions', predictionRoutes);
  app.use('/api/scanner', scannerRoutes);
  app.use('/api/chat', chatRoutes);

  app.get('/api/health', async (req, res) => {
    const ollama = Date.now() - (lastOllamaStatus().at || 0) < 15_000
      ? lastOllamaStatus()
      : await pingOllama();
    res.json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      apis: config.keys,
      ollama: {
        ok: ollama.ok,
        model: ollama.model,
        searchModel: ollama.searchModel || ollama.model,
        webSearch: config.ollama.webSearch
      },
      jobs: {
        locks: {
          scan: isLocked('scan'),
          evaluate: isLocked('evaluate'),
          backtest: isLocked('backtest'),
          warm: isLocked('warm')
        },
        last: getJobStatus()
      }
    });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
