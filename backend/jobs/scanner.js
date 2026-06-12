// Automated opportunity scanner with cross-sectional ranking and fundamentals.

import { getDB } from '../db/database.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { getStockNews, getFinnhubQuote } from '../services/finnhub.js';
import { getRssStockNews } from '../services/rssNews.js';
import { getUpcomingEarnings } from '../services/earningsCalendar.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';
import { getHorizonWeights, computeScore, buildTradePlan, buildReasons, computeEnsembleScore, blendForHorizon } from '../models/predictionEngine.js';
import {
  SCAN_GATES, applyRegimeAdjustment, classifyPick, buildWeightedReasons
} from '../models/scannerScoring.js';
import { getFundamentalSignals, mergeFundamentalSignals } from '../models/fundamentalsSignals.js';
import { getMarketRegime } from '../models/marketRegime.js';
import { rankCrossSectionally } from '../models/signalHygiene.js';
import { getSymbolsReadyForScan } from '../jobs/historyWarmer.js';
import { CORE_SCAN_SYMBOLS } from '../data/universe.js';

export { CORE_SCAN_SYMBOLS as SCAN_SYMBOLS };
export { getSymbolsReadyForScan };

const HISTORY_FRESH_MS = 3 * 3600_000;
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
    addAlert(db, ticker, 'news_spike', dir, `${ticker}: ${dir > 0 ? 'bullish' : 'bearish'} news surge`);
  }
  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 3) {
    addAlert(db, ticker, 'earnings_soon', 0, `${ticker}: earnings ${earnings.daysUntil === 0 ? 'today' : `in ${earnings.daysUntil}d`}`);
  }
}

async function scanSymbolRaw(db, ticker, horizonWeights, earningsMap, marketRegime) {
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
  const earnings = earningsMap[ticker] || earningsMap[ticker.replace('-', '.')] || null;

  const { signals: techSignals, indicators } = computeScore(candles, horizonWeights, news.score);
  const { signals: fundSignals } = await getFundamentalSignals(ticker, candles, earnings);
  const signals = mergeFundamentalSignals(techSignals, fundSignals);

  const weights5d = horizonWeights['5d']?.weights || {};
  const techScore = blendForHorizon(computeEnsembleScore(signals, weights5d), '5d');

  const buzzFactor = Math.min(1.5, Math.max(0.85, 0.85 + (news.buzz || 0) * 0.2));
  const catalyst = Math.max(-1, Math.min(1, news.score * buzzFactor + news.impactPct / 10));
  let composite = Math.max(-1, Math.min(1, techScore * (1 - SCAN_GATES.newsWeight) + catalyst * SCAN_GATES.newsWeight));
  composite = applyRegimeAdjustment(composite, indicators, marketRegime);

  let confidence = Math.min(0.92, 0.48 + Math.abs(composite) * 0.5);
  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 2) confidence *= 0.72;

  detectAlerts(db, ticker, indicators, news, earnings);

  return {
    ticker,
    composite,
    confidence: parseFloat(confidence.toFixed(3)),
    indicators,
    signals,
    news,
    earnings,
    weights5d,
    trend: indicators.trend
  };
}

function finalizeScanRow(raw, pick, crossRank, crossPercentile) {
  const { composite, confidence, indicators, signals, news, earnings, weights5d, trend } = raw;
  const score100 = Math.round(composite * 100);
  const provisionalDir = composite >= 0.15 ? 1 : composite <= -0.15 ? -1 : 0;
  const tradePlan = Math.abs(composite) >= 0.15
    ? buildTradePlan(provisionalDir, indicators, { confidence })
    : null;

  const action = pick.action;
  const direction = action === 'BUY' ? 1 : action === 'SELL' ? -1 : 0;
  const narrativeReasons = buildReasons(indicators, signals, news, direction || (pick.rawSignal === 'BUY' ? 1 : -1));
  const weightedReasons = buildWeightedReasons(signals, weights5d, news);
  const reasons = [...new Set([...weightedReasons, ...narrativeReasons])].slice(0, 5);

  if (earnings && earnings.daysUntil >= 0 && earnings.daysUntil <= 7) {
    reasons.unshift(`Earnings ${earnings.daysUntil === 0 ? 'TODAY' : `in ${earnings.daysUntil}d`}`);
  }

  return {
    ticker: raw.ticker,
    action,
    rawSignal: pick.rawSignal,
    quality: pick.quality,
    actionable: pick.actionable,
    flags: pick.flags,
    rank: pick.rank,
    crossRank,
    crossPercentile,
    score: score100,
    confidence,
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

export async function runScan(symbols) {
  if (scanning) return { skipped: true };
  scanning = true;
  const startedAt = Date.now();

  try {
    const db = getDB();
    const scanList = symbols?.length ? symbols : getSymbolsReadyForScan();
    const horizonWeights = getHorizonWeights();
    const [earningsMap, marketRegime] = await Promise.all([
      getUpcomingEarnings().catch(() => ({})),
      getMarketRegime().catch(() => ({ label: 'neutral', spyTrend: 0 }))
    ]);

    const rawResults = [];
    for (let i = 0; i < scanList.length; i += 5) {
      const batch = scanList.slice(i, i + 5);
      const settled = await Promise.allSettled(
        batch.map(s => scanSymbolRaw(db, s, horizonWeights, earningsMap, marketRegime))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) rawResults.push(r.value);
      }
      if (i + 5 < scanList.length) await new Promise(r => setTimeout(r, 400));
    }

    if (!rawResults.length) return { results: [], runId: null };

    const rankMap = rankCrossSectionally(rawResults);
    const universeSize = rawResults.length;

    const results = rawResults.map(raw => {
      const ranks = rankMap.get(raw.ticker) || {};
      const provisionalDir = raw.composite >= 0.15 ? 1 : raw.composite <= -0.15 ? -1 : 0;
      const tradePlan = Math.abs(raw.composite) >= 0.15
        ? buildTradePlan(provisionalDir, raw.indicators, { confidence: raw.confidence })
        : null;

      const pick = classifyPick({
        composite: raw.composite,
        confidence: raw.confidence,
        tradePlan,
        indicators: raw.indicators,
        earnings: raw.earnings,
        crossPercentile: ranks.crossPercentile,
        universeSize
      });

      return finalizeScanRow(raw, pick, ranks.crossRank, ranks.crossPercentile);
    });

    const runId = Date.now();
    const insert = db.prepare(`
      INSERT INTO scan_results
        (run_id, ticker, action, score, confidence, price, entry, stop, target, rr, position_pct,
         trend, rsi, adx, news_score, news_count, buzz, earnings_date, earnings_in_days, reasons, events,
         quality, actionable, raw_signal, flags, rank, cross_rank, cross_percentile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAll = db.transaction(rows => {
      for (const r of rows) {
        insert.run(
          runId, r.ticker, r.action, r.score, r.confidence, r.price, r.entry, r.stop, r.target,
          r.rr, r.positionPct, r.trend, r.rsi, r.adx, r.newsScore, r.newsCount, r.buzz,
          r.earningsDate, r.earningsInDays, JSON.stringify(r.reasons), JSON.stringify(r.events),
          r.quality, r.actionable ? 1 : 0, r.rawSignal, JSON.stringify(r.flags || []), r.rank,
          r.crossRank ?? null, r.crossPercentile ?? null
        );
      }
    });
    insertAll(results);

    const sorted = results.sort((a, b) => b.rank - a.rank);
    const actionable = sorted.filter(r => r.actionable);

    db.prepare(`DELETE FROM scan_results WHERE run_at < datetime('now', '-7 days')`).run();
    db.prepare(`DELETE FROM alerts WHERE created_at < datetime('now', '-14 days')`).run();

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[Scanner] ${results.length}/${scanList.length} symbols in ${secs}s → ${actionable.length} actionable · regime ${marketRegime?.label || 'n/a'}`);

    return { runId, results: sorted, marketRegime, universeSize: scanList.length };
  } finally {
    scanning = false;
  }
}

export function getLatestScan() {
  const db = getDB();
  const last = db.prepare('SELECT run_id, MAX(run_at) as run_at FROM scan_results GROUP BY run_id ORDER BY run_id DESC LIMIT 1').get();
  if (!last) return { runAt: null, results: [] };

  const rows = db.prepare('SELECT * FROM scan_results WHERE run_id = ?').all(last.run_id);
  return { runAt: last.run_at, results: rows.map(mapScanRow).sort((a, b) => (b.rank || 0) - (a.rank || 0)) };
}

function mapScanRow(r) {
  return {
    ticker: r.ticker,
    action: r.action,
    rawSignal: r.raw_signal || r.action,
    quality: r.quality || 'hold',
    actionable: !!r.actionable,
    flags: r.flags ? JSON.parse(r.flags) : [],
    rank: r.rank ?? Math.abs(r.score) * (r.confidence || 0.5),
    crossRank: r.cross_rank,
    crossPercentile: r.cross_percentile,
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
