import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { rateLimit } from '../lib/rateLimit.js';
import { requestLang } from '../lib/locale.js';
import { normalizeTicker } from '../lib/validate.js';
import { runDeskChat, sanitizeMessages } from '../services/chatService.js';

const router = Router();

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post('/', rateLimit({ windowMs: 60_000, max: 12 }), asyncHandler(async (req, res) => {
  const messages = sanitizeMessages(req.body?.messages);
  if (!messages.length) {
    return res.status(400).json({ success: false, error: 'Message required', code: 'BAD_CHAT' });
  }

  const lang = requestLang(req);
  const symbol = normalizeTicker(req.body?.symbol);
  const simple = req.body?.simple !== false && req.body?.simple !== '0';

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
    const result = await runDeskChat({
      messages,
      symbol,
      lang,
      simple,
      signal: ac.signal,
      onEvent: async (evt) => {
        if (ac.signal.aborted || res.writableEnded) return;
        if (evt.type === 'status') writeEvent(res, 'status', { phase: evt.phase, query: evt.query || '' });
        else if (evt.type === 'token') writeEvent(res, 'token', { text: evt.text });
      }
    });
    if (!res.writableEnded) {
      writeEvent(res, 'done', {
        sources: result.sources,
        searched: result.searched,
        model: result.model,
        searchModel: result.searchModel
      });
    }
  } catch (err) {
    if (!res.writableEnded) {
      writeEvent(res, 'error', {
        message: err.message || 'Chat failed',
        code: /offline/i.test(err.message || '') ? 'OLLAMA_OFF' : 'CHAT_FAILED'
      });
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}));

export default router;
