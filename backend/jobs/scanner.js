// Automated opportunity scanner — the "do the work for me" engine.
//
// Every run it sweeps the watchlist: price history (disk-cached), live quote,
// news + event detection, all indicators, earnings calendar. Each symbol gets
// a composite opportunity score, a BUY/SELL/HOLD call, a full trade plan, and
// plain-English reasons. Results are ranked and stored; notable signal changes
// (MACD cross, breakout, news spike, earnings ahead...) become alerts.

import { getDB } from '../db/database.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { getStockNews, getFinnhubQuote } from '../services/finnhub.js';
import { getRssStockNews } from '../services/rssNews.js';
import { getUpcomingEarnings } from '../services/earningsCalendar.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';
import { getHorizonWeights, computeScore, buildTradePlan, buildReasons } from '../models/predictionEngine.js';
import {
  SCAN_GATES, applyRegimeAdjustment, classifyPick, buildWeightedReasons
} from '../models/scannerScoring.js';

export const SCAN_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  'JPM', 'BAC', 'GS', 'V', 'MA', 'BRK-B', 'SPY', 'QQQ'
];

const HISTORY_FRESH_MS = 3 * 3600_000; // scanner tolerates 3h-old daily candles (quote overlays live price)
let scanning = false;

function dedupeArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = (a.headline || '').toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Overlay the live quote onto the last daily candle so signals see current price.
function withLiveQuote(candles, quote) {
  if (!quote?.price || !candles.length) return candles;
  const updated = candles.slice();
  const last = { ...updated[updated.length - 1] };
  last.close = quote.price;
  if (quote.price > last.high) last.high = quote.price;
  if (quote.price < last.low) last.low = quote.price;
  updated[updated.length - 1] = last;
  return updated;
}

function addAlert(db, ticker, kind, direction, message) {
  const today = new Date().toISOString().split('T')[0];
  try {
    db.prepare(`
      INSERT OR IGNORE INTO alerts (ticker, kind, direction, message, dedupe_key)
      VALUES (?, ?, ?, ?, ?)
    `).run(ticker, kind, direction, message, `${ticker}:${kind}:${today}`);
  } catch { /* ignore */ }
}

function detectAlerts(db, ticker, indicators, news, earnings) {
  const { macd, rsi, bb, maCross, breakout, week52, price } = indicators;

  if (macd?.crossed_above) addAlert(db, ticker, 'macd_cross', 1, `${ticker}: MACD bullish cross`);
  if (macd?.crossed_below) addAlert(db, ticker, 'macd_cross', -1, `${ticker}: MACD bearish cross`);
  if (rsi != null && rsi >= 78) addAlert(db, ticker, 'rsi_extreme', -1, `${ticker}: RSI ${Math.round(rsi)} — extremely overbought`);
  if (rsi != null && rsi <= 22) addAlert(db, ticker, 'rsi_extreme', 1, `${ticker}: RSI ${Math.round(rsi)} — extremely oversold`);
  if (bb && price > bb.upper) addAlert(db, ticker, 'bb_break', 1, `${ticker}: closed above upper Bollinger band`);
  if (bb && price < bb.lower) addAlert(db, ticker, 'bb_break', -1, `${ticker}: closed below lower Bollinger band`);
  if (maCross?.golden) addAlert(db, ticker, 'golden_cross', 1, `${ticker}: golden cross (SMA50 > SMA200)`);
  if (maCross?.death) addAlert(db, ticker, 'death_cross', -1, `${ticker}: death cross (SMA50 < SMA200)`);
  if (breakout?.type === 'up' && Math.abs(breakout.signal) >= 1) addAlert(db, ticker, 'breakout', 1, `${ticker}: 20-day breakout on heavy volume`);
  if (breakout?.type === 'down' && Math.abs(breakout.signal) >= 1) addAlert(db, ticker, 'breakout', -1, `${ticker}: 20-day breakdown on heavy volume`);
  if (week52?.position > 0.98) addAlert(db, ticker, 'week52', 1, `${ticker}: new 52-week high zone`);
  if (week52?.position < 0.04) addAlert(db, ticker, 'week52', -1, `${ticker}: 52-week low zone`);

  if (news.buzz >= 2 && Math.abs(news.score) > 0.2 && news.articleCount >= 4) {
    const dir = news.score > 0 ? 1 : -1;
    const evTxt = news.topEvents?.[0]?.label ? ` (${news.topEvents[0].label})` : '';
    addAlert(db, ticker, 'news_spike', dir, `${ticker}: ${dir > 0 ? 'bullish' : 'bearish'} news surge${evTxt} — ${news.buzz}× normal flow`);
  }
  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 3) {
    addAlert(db, ticker, 'earnings_soon', 0, `${ticker}: earnings ${earnings.daysUntil === 0 ? 'today' : `in ${earnings.daysUntil}d`}${earnings.hour ? ` (${earnings.hour})` : ''}`);
  }
}

async function scanSymbol(db, ticker, horizonWeights, earningsMap) {
  const [candlesRaw, quote, fhNews, rssNews] = await Promise.all([
    getHistoricalSeries(ticker, 420, HISTORY_FRESH_MS).catch(() => null),
    getFinnhubQuote(ticker).catch(() => null),
    getStockNews(ticker).catch(() => []),
    getRssStockNews(ticker).catch(() => [])
  ]);
  if (!candlesRaw || candlesRaw.length < 60) return null;

  const candles = withLiveQuote(candlesRaw, quote);
  const articles = dedupeArticles([...(fhNews || []), ...(rssNews || [])]);
  const news = analyzeArticles(articles, ticker);

  const { score: techScore, indicators, signals } = computeScore(candles, horizonWeights, news.score);
  const weights5d = horizonWeights['5d']?.weights || horizonWeights['5d'] || {};
  const trend = indicators.trend;
  const earnings = earningsMap[ticker] || earningsMap[ticker.replace('-', '.')] || null;

  const buzzFactor = Math.min(1.5, Math.max(0.85, 0.85 + (news.buzz || 0) * 0.2));
  const catalyst = Math.max(-1, Math.min(1, news.score * buzzFactor + news.impactPct / 10));
  let composite = Math.max(-1, Math.min(1, techScore * (1 - SCAN_GATES.newsWeight) + catalyst * SCAN_GATES.newsWeight));
  composite = applyRegimeAdjustment(composite, indicators);

  let confidence = Math.min(0.92, 0.48 + Math.abs(composite) * 0.5);
  const earningsRisk = earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 2;
  if (earningsRisk) confidence *= 0.72;

  const score100 = Math.round(composite * 100);
  const provisionalDir = composite >= 0.15 ? 1 : composite <= -0.15 ? -1 : 0;
  const tradePlan = Math.abs(composite) >= 0.15 ? buildTradePlan(provisionalDir, indicators) : null;

  const pick = classifyPick({ composite, confidence, tradePlan, indicators, earnings });
  const action = pick.action;
  const direction = action === 'BUY' ? 1 : action === 'SELL' ? -1 : 0;

  const narrativeReasons = buildReasons(indicators, signals, news, direction || (pick.rawSignal === 'BUY' ? 1 : -1));
  const weightedReasons = buildWeightedReasons(signals, weights5d, news);
  const reasons = [...new Set([...weightedReasons, ...narrativeReasons])].slice(0, 5);

  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 7) {
    reasons.unshift(`Earnings ${earnings.daysUntil === 0 ? 'TODAY' : `in ${earnings.daysUntil}d`}${earnings.hour ? ` (${earnings.hour.replace('bmo', 'before open').replace('amc', 'after close')})` : ''} — expect volatility`);
  }

  detectAlerts(db, ticker, indicators, news, earnings);

  return {
    ticker,
    action,
    rawSignal: pick.rawSignal,
    quality: pick.quality,
    actionable: pick.actionable,
    flags: pick.flags,
    rank: pick.rank,
    score: score100,
    confidence: parseFloat(confidence.toFixed(3)),
    price: indicators.price,
    entry: tradePlan?.entry ?? null,
    stop: tradePlan?.stop ?? null,
    target: tradePlan?.target ?? null,
    rr: tradePlan?.rr ?? null,
    positionPct: tradePlan?.positionPct ?? null,
    trend: trend?.label || null,
    rsi: indicators.rsi != null ? parseFloat(indicators.rsi.toFixed(1)) : null,
    adx: indicators.adx?.adx != null ? parseFloat(indicators.adx.adx.toFixed(1)) : null,
    newsScore: parseFloat((news.score || 0).toFixed(3)),
    newsCount: news.articleCount || 0,
    buzz: news.buzz || 0,
    earningsDate: earnings?.date || null,
    earningsInDays: earnings?.daysUntil ?? null,
    reasons,
    events: (news.topEvents || []).slice(0, 4)
  };
}

export async function runScan(symbols = SCAN_SYMBOLS) {
  if (scanning) return { skipped: true };
  scanning = true;
  const startedAt = Date.now();

  try {
    const db = getDB();
    const horizonWeights = getHorizonWeights();
    const earningsMap = await getUpcomingEarnings().catch(() => ({}));

    const results = [];
    // Small batches keep us well inside Finnhub's 60 req/min
    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const settled = await Promise.allSettled(batch.map(s => scanSymbol(db, s, horizonWeights, earningsMap)));
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) results.push(r.value);
      }
      if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 400));
    }

    if (!results.length) return { results: [], runId: null };

    const runId = Date.now();
    const insert = db.prepare(`
      INSERT INTO scan_results
        (run_id, ticker, action, score, confidence, price, entry, stop, target, rr, position_pct,
         trend, rsi, adx, news_score, news_count, buzz, earnings_date, earnings_in_days, reasons, events,
         quality, actionable, raw_signal, flags, rank)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAll = db.transaction(rows => {
      for (const r of rows) {
        insert.run(
          runId, r.ticker, r.action, r.score, r.confidence, r.price, r.entry, r.stop, r.target,
          r.rr, r.positionPct, r.trend, r.rsi, r.adx, r.newsScore, r.newsCount, r.buzz,
          r.earningsDate, r.earningsInDays, JSON.stringify(r.reasons), JSON.stringify(r.events),
          r.quality, r.actionable ? 1 : 0, r.rawSignal, JSON.stringify(r.flags || []), r.rank
        );
      }
    });
    insertAll(results);

    const sorted = results.sort((a, b) => b.rank - a.rank);
    const actionable = sorted.filter(r => r.actionable);

    // Housekeeping: keep a week of scans, two weeks of alerts
    db.prepare(`DELETE FROM scan_results WHERE run_at < datetime('now', '-7 days')`).run();
    db.prepare(`DELETE FROM alerts WHERE created_at < datetime('now', '-14 days')`).run();

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const buys = actionable.filter(r => r.action === 'BUY').length;
    const sells = actionable.filter(r => r.action === 'SELL').length;
    console.log(`[Scanner] ${results.length} symbols in ${secs}s → ${actionable.length} actionable (${buys} BUY, ${sells} SELL)`);

    return { runId, results: sorted };
  } finally {
    scanning = false;
  }
}

export function getLatestScan() {
  const db = getDB();
  const last = db.prepare('SELECT run_id, MAX(run_at) as run_at FROM scan_results GROUP BY run_id ORDER BY run_id DESC LIMIT 1').get();
  if (!last) return { runAt: null, results: [] };

  const rows = db.prepare('SELECT * FROM scan_results WHERE run_id = ?').all(last.run_id);
  const results = rows.map(mapScanRow).sort((a, b) => (b.rank || 0) - (a.rank || 0));

  return { runAt: last.run_at, results };
}

function mapScanRow(r) {
  const flags = r.flags ? JSON.parse(r.flags) : [];
  const rank = r.rank ?? Math.abs(r.score) * (r.confidence || 0.5);
  return {
    ticker: r.ticker,
    action: r.action,
    rawSignal: r.raw_signal || r.action,
    quality: r.quality || 'hold',
    actionable: !!r.actionable,
    flags,
    rank,
    score: r.score,
    confidence: r.confidence,
    price: r.price,
    entry: r.entry,
    stop: r.stop,
    target: r.target,
    rr: r.rr,
    positionPct: r.position_pct,
    trend: r.trend,
    rsi: r.rsi,
    adx: r.adx,
    newsScore: r.news_score,
    newsCount: r.news_count,
    buzz: r.buzz,
    earningsDate: r.earnings_date,
    earningsInDays: r.earnings_in_days,
    reasons: r.reasons ? JSON.parse(r.reasons) : [],
    events: r.events ? JSON.parse(r.events) : []
  };
}

export function getAlerts(limit = 40) {
  const db = getDB();
  return db.prepare('SELECT * FROM alerts ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
}
