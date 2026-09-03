import { Router } from 'express';
import {
  generateForTicker,
  tradeSetupForTicker,
  getAccuracySnapshot,
  getPredictionHistory,
  getPredictionsForTicker,
  runEvaluation,
  runModelBacktest
} from '../services/predictionService.js';
import { asyncHandler, ok } from '../lib/errors.js';
import { requireTicker, normalizeTicker, clampInt } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { requestLang } from '../lib/locale.js';

const router = Router();

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get('/accuracy', (req, res) => ok(res, getAccuracySnapshot()));

router.post('/backtest', rateLimit({ windowMs: 60 * 60_000, max: 2 }), asyncHandler(async (req, res) => {
  return ok(res, await runModelBacktest());
}));

router.get('/history', (req, res) => {
  const ticker = normalizeTicker(req.query.ticker);
  const limit = clampInt(req.query.limit, { min: 1, max: 200, fallback: 50 });
  return ok(res, getPredictionHistory({
    ticker,
    horizon: req.query.horizon,
    limit,
    resolved: req.query.resolved
  }));
});

router.post('/generate/:symbol/stream', rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(async (req, res) => {
  const ticker = requireTicker(req.params.symbol);
  const name = req.body?.name || req.query.name;
  const force = req.body?.force === true || req.query.force === '1';

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) ac.abort();
  };
  res.on('close', onClose);

  try {
    await generateForTicker(ticker, name, {
      force,
      lang: requestLang(req),
      style: req.body?.style,
      notes: req.body?.notes,
      onEvent: async (evt) => {
        if (ac.signal.aborted || res.writableEnded) return;
        if (evt.type === 'status') writeEvent(res, 'status', { phase: evt.phase });
        else if (evt.type === 'token') writeEvent(res, 'token', { text: evt.text });
        else if (evt.type === 'done') writeEvent(res, 'done', { data: evt.data });
      }
    });
  } catch (err) {
    if (!res.writableEnded) {
      writeEvent(res, 'error', {
        message: err.message || 'Prediction failed',
        code: /offline/i.test(err.message || '') ? 'OLLAMA_OFF' : 'PREDICT_FAILED'
      });
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}));

router.post('/generate/:symbol', rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(async (req, res) => {
  const ticker = requireTicker(req.params.symbol);
  const name = req.body?.name || req.query.name;
  const force = req.body?.force === true || req.query.force === '1';
  return ok(res, await generateForTicker(ticker, name, {
    force,
    lang: requestLang(req),
    style: req.body?.style,
    notes: req.body?.notes
  }));
}));

router.post('/trade-setup/:symbol', rateLimit({ windowMs: 60_000, max: 20 }), asyncHandler(async (req, res) => {
  const ticker = requireTicker(req.params.symbol);
  const maxDays = clampInt(req.body?.maxDays, { min: 1, max: 2000, fallback: 5 });
  return ok(res, await tradeSetupForTicker(ticker, maxDays));
}));

router.get('/:symbol', asyncHandler(async (req, res) => {
  const ticker = requireTicker(req.params.symbol);
  return ok(res, getPredictionsForTicker(ticker));
}));

router.post('/evaluate', rateLimit({ windowMs: 60 * 60_000, max: 10 }), asyncHandler(async (req, res) => {
  return ok(res, await runEvaluation());
}));

export default router;
