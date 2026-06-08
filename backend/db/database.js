import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'financially.db');

import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '..', 'data'), { recursive: true });

let db;

export function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL DEFAULT 'global',
      weights TEXT NOT NULL,
      iteration INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      predicted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      target_date TEXT NOT NULL,
      horizon TEXT NOT NULL,
      prediction TEXT NOT NULL,
      confidence REAL NOT NULL,
      score REAL NOT NULL,
      price_at_prediction REAL NOT NULL,
      signals TEXT NOT NULL,
      weights_used TEXT NOT NULL,
      resolved_at DATETIME,
      actual_price REAL,
      correct INTEGER,
      price_change_pct REAL
    );

    CREATE TABLE IF NOT EXISTS accuracy_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL UNIQUE,
      total INTEGER DEFAULT 0,
      correct INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS news_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      data TEXT NOT NULL,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker);
    CREATE INDEX IF NOT EXISTS idx_predictions_resolved ON predictions(correct);
    CREATE INDEX IF NOT EXISTS idx_predictions_target ON predictions(target_date);
  `);

  // Seed default model weights if not exists
  const existingWeights = db.prepare('SELECT id FROM model_weights WHERE name = ?').get('global');
  if (!existingWeights) {
    const defaultWeights = {
      rsi: 0.18,
      macd: 0.18,
      sma_crossover: 0.14,
      ema_crossover: 0.14,
      bollinger: 0.12,
      volume_trend: 0.10,
      news_sentiment: 0.14
    };
    db.prepare('INSERT INTO model_weights (name, weights, iteration) VALUES (?, ?, 0)')
      .run('global', JSON.stringify(defaultWeights));
  }

  // Seed accuracy metrics
  for (const horizon of ['1d', '5d', '30d']) {
    db.prepare('INSERT OR IGNORE INTO accuracy_metrics (horizon) VALUES (?)').run(horizon);
  }

  console.log('Database initialized at:', DB_PATH);
}
