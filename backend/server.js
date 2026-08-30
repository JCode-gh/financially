import 'dotenv/config';
import { createApp } from './app.js';
import { initDB } from './db/database.js';
import { startScheduler } from './jobs/scheduler.js';
import { initLiveStream } from './services/liveStream.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { pingOllama } from './services/ollama.js';

initDB();

const app = createApp();
const server = app.listen(config.port, '127.0.0.1', () => {
  logger.info(`Financially backend on http://127.0.0.1:${config.port}`);
  logger.info(`Health: http://localhost:${config.port}/api/health`);
  logger.info(`Finnhub: ${config.keys.finnhub ? 'yes' : 'no'}`);
  logger.info(`NewsAPI: ${config.keys.newsApi ? 'yes' : 'no'}`);
  logger.info(`Twelve Data: ${config.keys.twelveData ? 'yes' : 'no'}`);
});

initLiveStream(server);
startScheduler();
pingOllama().then(s => {
  const extra = s.wanted && s.model !== s.wanted ? ` (wanted ${s.wanted})` : '';
  logger.info(`Ollama ${s.ok ? 'ready' : 'offline'} (${s.model})${extra}`);
});
