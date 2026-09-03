import axios from 'axios';
import { API_BASE_URL } from '../config/api.js';
import { readLocale } from '../i18n/locale.js';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000
});

http.interceptors.request.use(config => {
  const locale = readLocale();
  config.headers['Accept-Language'] = locale;
  if (config.data && typeof config.data === 'object' && !Array.isArray(config.data) && config.data.lang == null) {
    config.data = { ...config.data, lang: locale };
  }
  return config;
});

http.interceptors.response.use(
  res => res,
  err => {
    err.normalized = {
      message: err.response?.data?.error || err.message || 'Request failed',
      status: err.response?.status || 0,
      code: err.response?.data?.code || null
    };
    return Promise.reject(err);
  }
);

function symPath(symbol) {
  return encodeURIComponent(String(symbol).trim());
}

export function unwrap(res) {
  return res.data?.data;
}

export const stocksApi = {
  market: () => http.get('/stocks/market'),
  watchlist: (symbols) => http.get('/stocks/watchlist', { params: { symbols: symbols?.join(',') } }),
  quote: (symbol) => http.get(`/stocks/quote/${symPath(symbol)}`),
  historical: (symbol, days = 100, interval = '1day') =>
    http.get(`/stocks/historical/${symPath(symbol)}`, { params: { days, interval } }),
  historicalBatch: (symbols, days = 63) =>
    http.get('/stocks/historical-batch', { params: { symbols: symbols?.join(','), days } }),
  search: (q) => http.get('/stocks/search', { params: { q } }),
  resolve: (q) => http.get('/stocks/resolve', { params: { q } })
};

export const newsApi = {
  market: (symbols, names) => http.get('/news/market', {
    params: {
      symbols: symbols?.join(','),
      names: names?.join('|')
    }
  }),
  stock: (symbol, name) => http.get(`/news/stock/${symPath(symbol)}`, { params: { name } })
};

export const predictionsApi = {
  accuracy: () => http.get('/predictions/accuracy'),
  history: (params) => http.get('/predictions/history', { params }),
  forSymbol: (symbol) => http.get(`/predictions/${symPath(symbol)}`),
  generate: (symbol, name, { force, style, notes } = {}) =>
    http.post(`/predictions/generate/${symPath(symbol)}`, {
      name,
      force: !!force,
      lang: readLocale(),
      style: style || undefined,
      notes: notes || undefined
    }, {
      timeout: 120000,
      params: { lang: readLocale() }
    }),
  tradeSetup: (symbol, maxDays) => http.post(`/predictions/trade-setup/${symPath(symbol)}`, { maxDays }),
  evaluate: () => http.post('/predictions/evaluate'),
  backtest: () => http.post('/predictions/backtest')
};

export async function streamGeneratePrediction({ symbol, name, force, style, notes, lang, onEvent, signal } = {}) {
  const res = await fetch(`${API_BASE_URL}/predictions/generate/${symPath(symbol)}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Language': lang || readLocale()
    },
    body: JSON.stringify({
      name,
      force: !!force,
      lang: lang || readLocale(),
      style: style || undefined,
      notes: notes || undefined
    }),
    signal
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || 'Prediction failed');
    err.normalized = { message: body.error || 'Prediction failed', status: res.status, code: body.code || null };
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Prediction stream unavailable');

  const decoder = new TextDecoder();
  let buf = '';
  let sawError = null;
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const parsed = parseSseBlock(part);
      if (!parsed) continue;
      if (parsed.event === 'error') {
        sawError = parsed.data;
        continue;
      }
      if (parsed.event === 'done') {
        result = parsed.data?.data || parsed.data;
      }
      if (onEvent) {
        if (parsed.event === 'token') onEvent({ type: 'token', text: parsed.data.text || '' });
        else if (parsed.event === 'status') onEvent({ type: 'status', phase: parsed.data.phase });
        else if (parsed.event === 'done') onEvent({ type: 'done', data: result });
      }
    }
  }

  if (sawError) {
    const err = new Error(sawError.message || 'Prediction failed');
    err.normalized = { message: sawError.message || 'Prediction failed', status: 0, code: sawError.code || null };
    throw err;
  }

  return result;
}

export const scannerApi = {
  latest: () => http.get('/scanner/latest'),
  run: (symbols) => http.post('/scanner/run', symbols ? { symbols } : {}),
  alerts: (limit = 30) => http.get('/scanner/alerts', { params: { limit } }),
  earnings: (symbols) => http.get('/scanner/earnings', { params: { symbols: symbols?.join(',') } })
};

export const healthApi = {
  check: () => http.get('/health')
};

function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: { text: dataLines.join('\n') } };
  }
}

export async function streamDeskChat({ messages, symbol, watchlist, simple, lang, onEvent, signal } = {}) {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Accept-Language': lang || readLocale()
    },
    body: JSON.stringify({
      messages,
      symbol: symbol || undefined,
      watchlist: Array.isArray(watchlist) && watchlist.length ? watchlist : undefined,
      simple: simple !== false,
      lang: lang || readLocale()
    }),
    signal
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || 'Chat failed');
    err.normalized = { message: body.error || 'Chat failed', status: res.status, code: body.code || null };
    throw err;
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Chat stream unavailable');

  const decoder = new TextDecoder();
  let buf = '';
  let sawError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      const parsed = parseSseBlock(part);
      if (!parsed) continue;
      if (parsed.event === 'error') {
        sawError = parsed.data;
        continue;
      }
      if (onEvent) {
        if (parsed.event === 'token') onEvent({ type: 'token', text: parsed.data.text || '' });
        else if (parsed.event === 'status') onEvent({ type: 'status', phase: parsed.data.phase, query: parsed.data.query });
        else if (parsed.event === 'done') onEvent({ type: 'done', ...parsed.data });
      }
    }
  }

  if (sawError) {
    const err = new Error(sawError.message || 'Chat failed');
    err.normalized = { message: sawError.message || 'Chat failed', status: 0, code: sawError.code || null };
    throw err;
  }
}

export default http;
