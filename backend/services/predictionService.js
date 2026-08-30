import { getDB } from '../db/database.js';
import { getHistoricalSeries } from './historyProvider.js';
import { getQuote } from '../providers/marketData.js';
import { getStockArticles } from '../providers/news.js';
import { decideTrade, summarizeArticles } from './ollama.js';
import { enrichArticles, fallbackSnippet, isPriceMovingArticle, isUsefulText, pickSourceArticles } from '../lib/articleBody.js';
import { logger } from '../lib/logger.js';
import { createTtlCache } from '../lib/cache.js';
import {
  generatePredictions,
  getModelWeights,
  getHorizonWeights,
  computeScore,
  buildTradePlanForDays,
  buildReasons,
  horizonTarget,
  scoreToPrediction,
  PREDICTION_THRESHOLDS
} from '../models/predictionEngine.js';
import { analyzeArticles } from '../models/sentimentAnalyzer.js';
import { evaluatePredictions, recalculateAccuracy } from '../jobs/predictionEvaluator.js';
import { runBacktest, getBacktestResults } from '../jobs/backtester.js';
import { getSymbolsReadyForScan } from '../jobs/historyWarmer.js';
import { getCalibrationCurve } from '../models/calibration.js';
import { requireHistory } from '../providers/marketData.js';
import { withLock } from '../lib/jobLock.js';
import { AppError } from '../lib/errors.js';

const genCache = createTtlCache();
const GEN_TTL_MS = 3 * 60_000;

async function loadModelInputs(ticker, name) {
  const [candles, articles, quote] = await Promise.all([
    getHistoricalSeries(ticker, 500),
    getStockArticles(ticker, name),
    getQuote(ticker).catch(() => null)
  ]);
  return {
    candles: requireHistory(candles, ticker),
    articles,
    quote,
    name: name || quote?.name || ticker
  };
}

function fiveDayFrom(result) {
  return result.predictions?.find(p => p.horizon === '5d') || result.predictions?.[1] || {};
}

function grounded(items, corpus) {
  const text = String(corpus || '').toLowerCase();
  return (items || []).filter(item => {
    const words = String(item).toLowerCase().split(/\W+/).filter(w => w.length > 3);
    return words.some(w => text.includes(w));
  });
}

function reconcileAi(ai, result, articles, lang = 'en') {
  if (!ai) return ai;
  const five = fiveDayFrom(result);
  const quant = five.prediction || 'NEUTRAL';
  const newsScore = result.newsSentiment?.score || 0;
  const corpus = [
    ...(articles || []).flatMap(a => [a.headline, a.summary]),
    ...(result.newsSentiment?.topEvents || []).map(e => e.label),
    ...(result.reasons || [])
  ].join(' ');

  ai.catalysts = grounded(ai.catalysts, corpus);
  ai.risks = grounded(ai.risks, [
    corpus,
    String(result.indicators?.support ?? ''),
    String(result.indicators?.resistance ?? ''),
    String(result.indicators?.price ?? '')
  ].join(' '));
  if (!ai.risks?.length) {
    const res = result.indicators?.resistance;
    const sup = result.indicators?.support;
    const n = v => lang === 'nl' ? Number(v).toFixed(2).replace('.', ',') : Number(v).toFixed(2);
    if (ai.action === 'BUY' && res) {
      ai.risks = [lang === 'nl' ? `De koers kan afketsen op ${n(res)}` : `Price can stall at ${n(res)}`];
    } else if (ai.action === 'SELL' && sup) {
      ai.risks = [lang === 'nl' ? `De short faalt als ${n(sup)} standhoudt` : `Short fails if ${n(sup)} holds`];
    }
  }
  if (quant === 'NEUTRAL' && ai.action !== 'HOLD') {
    ai.disagreement = 'news_vs_tech';
    ai.conviction = Math.min(ai.conviction, 58);
    if (Math.abs(newsScore) < 0.15) {
      ai.action = 'HOLD';
      ai.conviction = Math.min(ai.conviction, 48);
      ai.doNow = ai.doNow || (lang === 'nl'
        ? 'Blijf aan de zijlijn — het model is vlak en het nieuws is niet overtuigend.'
        : 'Stand aside — quant is flat and news is not decisive.');
    }
  }
  if ((quant === 'UP' && ai.action === 'SELL') || (quant === 'DOWN' && ai.action === 'BUY')) {
    ai.disagreement = 'news_vs_tech';
    ai.conviction = Math.min(ai.conviction, 60);
  }
  return ai;
}

function sourceFields(a) {
  return {
    title: a.headline || a.title || '',
    url: a.url || a.link || '',
    source: a.source || '',
    text: String(a.body || '').replace(/\s+/g, ' ').trim()
  };
}

function packSources(items, summaries = [], digest = '') {
  return {
    digest: String(digest || '').trim(),
    sources: items.map((s, i) => ({
      title: s.title,
      url: s.url,
      source: s.source,
      summary: String(summaries[i] || fallbackSnippet(s.text, s.title)).trim()
    }))
  };
}

async function finishSources(articles, lang, ticker = '') {
  const items = (articles || [])
    .filter(a => isPriceMovingArticle(a, ticker) && isUsefulText(a.body || a.text || a.summary || '', a.headline || a.title || ''))
    .map(sourceFields)
    .filter(s => s.title && s.url && !/news\.google\.com\/search\?/i.test(s.url));
  if (!items.length) return { digest: '', sources: [] };
  const raw = await summarizeArticles(items, lang).catch(() => ({ summaries: [], digest: '' }));
  const summaries = Array.isArray(raw) ? raw : (raw.summaries || []);
  const digest = Array.isArray(raw) ? '' : (raw.digest || '');
  return packSources(items, summaries, digest);
}

async function attachAiDecision(result, articles, name, quote, lang = 'en') {
  const picked = pickSourceArticles(articles, result.ticker);
  const enrichPromise = enrichArticles(picked, articles, result.ticker);
  try {
    const five = fiveDayFrom(result);
    const plan = result.tradePlan;
    const [ai, enriched] = await Promise.all([
      decideTrade({
        ticker: result.ticker,
        name,
        price: result.indicators?.price,
        dayChange: quote?.changePct,
        trend: result.trend?.label,
        rsi: result.indicators?.rsi,
        adx: result.indicators?.adx,
        week52: result.indicators?.week52Position,
        support: result.indicators?.support,
        resistance: result.indicators?.resistance,
        fiveDay: five,
        tradePlan: plan ? `${plan.direction} entry ${plan.entry} stop ${plan.stop} target ${plan.target} R:R ${plan.rr}` : 'none',
        signals: result.signals,
        newsLabel: result.newsSentiment?.label,
        newsScore: result.newsSentiment?.score,
        events: (result.newsSentiment?.topEvents || []).map(e => e.label),
        headlines: (articles || []).slice(0, 8).map(a => ({
          headline: a.headline,
          summary: (a.summary || '').slice(0, 160),
          url: a.url || a.link || '',
          source: a.source || ''
        })),
        reasons: result.reasons,
        lang
      }),
      enrichPromise
    ]);
    const packed = await finishSources(enriched, lang, result.ticker);
    return {
      ...result,
      ai: reconcileAi(ai, result, articles, lang),
      newsUsed: (articles || []).length,
      sourcesDigest: packed.digest,
      sources: packed.sources
    };
  } catch (err) {
    logger.warn(`Ollama decision skipped: ${err.message}`);
    const enriched = await enrichPromise.catch(() => picked);
    const packed = await finishSources(enriched, lang, result.ticker).catch(() => packSources(
      picked.map(a => ({
        title: a.headline || a.title || '',
        url: a.url || a.link || '',
        source: a.source || '',
        text: a.summary || a.description || ''
      })).filter(s => s.title && s.url)
    ));
    return {
      ...result,
      ai: null,
      aiError: err.message,
      newsUsed: (articles || []).length,
      sourcesDigest: packed.digest,
      sources: packed.sources
    };
  }
}

export async function generateForTicker(ticker, name, { force, lang = 'en' } = {}) {
  const locale = lang === 'nl' ? 'nl' : 'en';
  const key = `desk_${ticker}_${locale}_v18`;
  if (force) genCache.cache.delete(key);
  return genCache.cached(key, GEN_TTL_MS, async () => {
    const { candles, articles, name: resolvedName, quote } = await loadModelInputs(ticker, name);
    const result = await generatePredictions(ticker, candles, articles);
    return attachAiDecision(result, articles, resolvedName, quote, locale);
  });
}

export async function tradeSetupForTicker(ticker, maxDays, name) {
  const { candles, articles } = await loadModelInputs(ticker, name);
  const horizonWeights = getHorizonWeights();
  const newsSentiment = analyzeArticles(articles, ticker);
  const { score, indicators, signals, trend } = computeScore(candles, horizonWeights, newsSentiment.score);

  const price = indicators.price;
  const atr = indicators.atr || price * 0.02;
  const t5 = PREDICTION_THRESHOLDS['5d'];
  const direction = score >= t5.moderate ? 1 : score <= -t5.moderate ? -1 : 0;
  const { confidence } = scoreToPrediction(score, '5d');

  const tradePlan = direction !== 0
    ? buildTradePlanForDays(direction, indicators, maxDays, score)
    : null;

  const reasons = buildReasons(indicators, signals, newsSentiment, direction);
  const { expectedMovePct } = horizonTarget(maxDays, score, price, atr);

  return {
    ticker,
    maxDays,
    direction: direction > 0 ? 'LONG' : direction < 0 ? 'SHORT' : 'NEUTRAL',
    confidence: parseFloat(confidence.toFixed(3)),
    expectedMovePct: parseFloat(expectedMovePct.toFixed(2)),
    tradePlan,
    reasons,
    trend: { label: trend.label, direction: trend.direction },
    support: indicators.sr?.support?.price ? parseFloat(indicators.sr.support.price.toFixed(2)) : null,
    resistance: indicators.sr?.resistance?.price ? parseFloat(indicators.sr.resistance.price.toFixed(2)) : null,
    atr: atr ? parseFloat(atr.toFixed(2)) : null,
    price: parseFloat(price.toFixed(2))
  };
}

export function getAccuracySnapshot() {
  const db = getDB();
  const metrics = db.prepare('SELECT * FROM accuracy_metrics ORDER BY horizon').all();
  const weights = getModelWeights();
  const backtest = getBacktestResults();

  const recentPreds = db.prepare(`
    SELECT signals, weights_used, correct, score, horizon
    FROM predictions WHERE correct IS NOT NULL
    ORDER BY resolved_at DESC LIMIT 200
  `).all();

  const indicatorStats = {};
  recentPreds.forEach(p => {
    let signals;
    try { signals = JSON.parse(p.signals); } catch { return; }
    const expected = p.score >= 0 ? 1 : -1;
    for (const [ind, sig] of Object.entries(signals)) {
      if (!indicatorStats[ind]) indicatorStats[ind] = { correct: 0, total: 0 };
      const signalDir = sig > 0 ? 1 : sig < 0 ? -1 : 0;
      if (signalDir !== 0) {
        indicatorStats[ind].total++;
        if ((signalDir === expected && p.correct === 1) ||
            (signalDir !== expected && p.correct === 0)) {
          indicatorStats[ind].correct++;
        }
      }
    }
  });

  return {
    horizons: metrics,
    backtest: backtest.map(b => ({
      horizon: b.horizon,
      total: b.total,
      correct: b.correct,
      accuracy: b.accuracy,
      symbols: b.symbols,
      trainedAt: b.trained_at,
      indicators: b.details,
      expectancy: b.expectancy,
      profitFactor: b.profit_factor,
      maxDrawdown: b.max_drawdown,
      avgR: b.avg_rr,
      winRate: b.win_rate,
      sharpeLike: b.sharpe_like,
      costBps: b.cost_bps
    })),
    calibration: {
      '5d': getCalibrationCurve('5d'),
      '1d': getCalibrationCurve('1d'),
      '30d': getCalibrationCurve('30d')
    },
    modelWeights: weights.weights,
    modelIteration: weights.iteration,
    indicatorStats: Object.fromEntries(
      Object.entries(indicatorStats).map(([k, v]) => [k, {
        ...v,
        accuracy: v.total > 0 ? parseFloat((v.correct / v.total * 100).toFixed(1)) : null
      }])
    ),
    totalResolved: recentPreds.length
  };
}

export function getPredictionHistory({ ticker, horizon, limit = 50, resolved } = {}) {
  const db = getDB();
  let query = 'SELECT * FROM predictions WHERE 1=1';
  const params = [];
  if (ticker) { query += ' AND ticker = ?'; params.push(ticker); }
  if (horizon) { query += ' AND horizon = ?'; params.push(horizon); }
  if (resolved === 'true') query += ' AND correct IS NOT NULL';
  if (resolved === 'false') query += ' AND correct IS NULL';
  query += ' ORDER BY predicted_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params).map(r => ({
    ...r,
    signals: JSON.parse(r.signals),
    weights_used: JSON.parse(r.weights_used)
  }));
}

export function getPredictionsForTicker(ticker) {
  const db = getDB();
  const latest = db.prepare(`
    SELECT p.*, m.weights as current_weights
    FROM predictions p
    CROSS JOIN model_weights m ON m.name = 'global'
    WHERE p.ticker = ?
    ORDER BY p.predicted_at DESC
    LIMIT 30
  `).all(ticker);

  const activePreds = db.prepare(`
    SELECT * FROM predictions
    WHERE ticker = ? AND correct IS NULL
    ORDER BY predicted_at DESC
  `).all(ticker);

  const parseRow = r => ({
    ...r,
    signals: JSON.parse(r.signals),
    weights_used: JSON.parse(r.weights_used),
    ...(r.current_weights ? { current_weights: JSON.parse(r.current_weights) } : {})
  });

  return {
    active: activePreds.map(parseRow),
    history: latest.map(parseRow)
  };
}

export async function runEvaluation() {
  const result = await withLock('evaluate', async () => {
    const data = await evaluatePredictions();
    recalculateAccuracy();
    return data;
  });
  if (result?.skipped) throw new AppError('Evaluation already running', 409, 'BUSY');
  return result;
}

export async function runModelBacktest() {
  const result = await withLock('backtest', async () => runBacktest(getSymbolsReadyForScan()));
  if (result?.skipped) throw new AppError('Backtest already running', 409, 'BUSY');
  return result;
}
