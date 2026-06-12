import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'financially.db');

import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '..', 'data'), { recursive: true });

let db;

// One weight per signal the ensemble can produce. New keys added here are
// auto-merged into an existing weights row on startup (see migrateWeights).
// Roughly balanced between trend-followers and mean-reverters: which family
// should dominate flips with the market regime, so the walk-forward learning
// (not the defaults) decides who gets the vote.
export const DEFAULT_WEIGHTS = {
  momentum: 0.11,
  trend_regime: 0.06,
  sma_crossover: 0.08,
  ema_crossover: 0.07,
  breakout: 0.08,
  adx_trend: 0.05,
  volume_trend: 0.06,
  news_sentiment: 0.10,
  macd: 0.05,
  rsi: 0.06,
  stochastic: 0.05,
  bollinger: 0.04,
  mfi: 0.04,
  valuation: 0.06,
  growth: 0.05,
  quality: 0.05,
  earnings_drift: 0.04
};

// Live-only signals — excluded from walk-forward backtest weight training
export const LIVE_ONLY_WEIGHT_KEYS = ['news_sentiment', 'valuation', 'growth', 'quality', 'earnings_drift'];

export function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// Ensure a stored weights row contains every signal key the current model
// emits. Missing keys get their default weight, then everything renormalizes
// by total |weight| (weights are signed).
function migrateWeights(db, name = 'global') {
  const row = db.prepare('SELECT weights FROM model_weights WHERE name = ?').get(name);
  if (!row) return;
  let weights;
  try { weights = JSON.parse(row.weights); } catch { weights = null; }
  if (!weights) return;

  let changed = false;
  for (const [key, def] of Object.entries(DEFAULT_WEIGHTS)) {
    if (weights[key] === undefined) { weights[key] = def; changed = true; }
  }
  if (!changed) return;

  const total = Object.values(weights).reduce((a, b) => a + Math.abs(b), 0);
  for (const key of Object.keys(weights)) {
    weights[key] = parseFloat((weights[key] / total).toFixed(6));
  }
  db.prepare('UPDATE model_weights SET weights = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
    .run(JSON.stringify(weights), name);
  console.log(`[DB] Migrated model weights (${name}) with new signal keys.`);
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

    CREATE TABLE IF NOT EXISTS scan_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ticker TEXT NOT NULL,
      action TEXT NOT NULL,
      score REAL NOT NULL,
      confidence REAL,
      price REAL,
      entry REAL,
      stop REAL,
      target REAL,
      rr REAL,
      position_pct REAL,
      trend TEXT,
      rsi REAL,
      adx REAL,
      news_score REAL,
      news_count INTEGER,
      buzz REAL,
      earnings_date TEXT,
      earnings_in_days INTEGER,
      reasons TEXT,
      events TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_run ON scan_results(run_id);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ticker TEXT NOT NULL,
      kind TEXT NOT NULL,
      direction INTEGER DEFAULT 0,
      message TEXT NOT NULL,
      dedupe_key TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

    CREATE TABLE IF NOT EXISTS backtest_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL UNIQUE,
      total INTEGER DEFAULT 0,
      correct INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 0,
      symbols INTEGER DEFAULT 0,
      details TEXT,
      trained_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calibration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      horizon TEXT NOT NULL,
      bucket_low REAL NOT NULL,
      bucket_high REAL NOT NULL,
      total INTEGER DEFAULT 0,
      correct INTEGER DEFAULT 0,
      hit_rate REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(horizon, bucket_low)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker);
    CREATE INDEX IF NOT EXISTS idx_predictions_resolved ON predictions(correct);
    CREATE INDEX IF NOT EXISTS idx_predictions_target ON predictions(target_date);
  `);

  // Seed weight rows: one per horizon (each learns against its own forward
  // return) plus 'global' which mirrors the 5d set for backward compatibility.
  for (const name of ['global', 'h1d', 'h5d', 'h30d']) {
    const existing = db.prepare('SELECT id FROM model_weights WHERE name = ?').get(name);
    if (!existing) {
      db.prepare('INSERT INTO model_weights (name, weights, iteration) VALUES (?, ?, 0)')
        .run(name, JSON.stringify(DEFAULT_WEIGHTS));
    } else {
      migrateWeights(db, name);
    }
  }

  // Seed accuracy metrics
  for (const horizon of ['1d', '5d', '30d']) {
    db.prepare('INSERT OR IGNORE INTO accuracy_metrics (horizon) VALUES (?)').run(horizon);
  }

  migrateScanColumns(db);
  migrateBacktestColumns(db);
  migrateScanRankColumns(db);

  console.log('Database initialized at:', DB_PATH);
}

function migrateScanColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(scan_results)').all().map(c => c.name));
  if (!cols.has('quality')) db.exec('ALTER TABLE scan_results ADD COLUMN quality TEXT');
  if (!cols.has('actionable')) db.exec('ALTER TABLE scan_results ADD COLUMN actionable INTEGER DEFAULT 0');
  if (!cols.has('raw_signal')) db.exec('ALTER TABLE scan_results ADD COLUMN raw_signal TEXT');
  if (!cols.has('flags')) db.exec('ALTER TABLE scan_results ADD COLUMN flags TEXT');
  if (!cols.has('rank')) db.exec('ALTER TABLE scan_results ADD COLUMN rank REAL');
}

function migrateScanRankColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(scan_results)').all().map(c => c.name));
  if (!cols.has('cross_rank')) db.exec('ALTER TABLE scan_results ADD COLUMN cross_rank REAL');
  if (!cols.has('cross_percentile')) db.exec('ALTER TABLE scan_results ADD COLUMN cross_percentile REAL');
}

function migrateBacktestColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(backtest_results)').all().map(c => c.name));
  if (!cols.has('expectancy')) db.exec('ALTER TABLE backtest_results ADD COLUMN expectancy REAL DEFAULT 0');
  if (!cols.has('profit_factor')) db.exec('ALTER TABLE backtest_results ADD COLUMN profit_factor REAL DEFAULT 0');
  if (!cols.has('max_drawdown')) db.exec('ALTER TABLE backtest_results ADD COLUMN max_drawdown REAL DEFAULT 0');
  if (!cols.has('avg_rr')) db.exec('ALTER TABLE backtest_results ADD COLUMN avg_rr REAL DEFAULT 0');
  if (!cols.has('cost_bps')) db.exec('ALTER TABLE backtest_results ADD COLUMN cost_bps REAL DEFAULT 10');
  if (!cols.has('win_rate')) db.exec('ALTER TABLE backtest_results ADD COLUMN win_rate REAL DEFAULT 0');
  if (!cols.has('sharpe_like')) db.exec('ALTER TABLE backtest_results ADD COLUMN sharpe_like REAL DEFAULT 0');
}
