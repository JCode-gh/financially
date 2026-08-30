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
  generate: (symbol, name, { force } = {}) =>
    http.post(`/predictions/generate/${symPath(symbol)}`, { name, force: !!force, lang: readLocale() }, {
      timeout: 110000,
      params: { lang: readLocale() }
    }),
  tradeSetup: (symbol, maxDays) => http.post(`/predictions/trade-setup/${symPath(symbol)}`, { maxDays }),
  evaluate: () => http.post('/predictions/evaluate'),
  backtest: () => http.post('/predictions/backtest')
};

export const scannerApi = {
  latest: () => http.get('/scanner/latest'),
  run: (symbols) => http.post('/scanner/run', symbols ? { symbols } : {}),
  alerts: (limit = 30) => http.get('/scanner/alerts', { params: { limit } }),
  earnings: (symbols) => http.get('/scanner/earnings', { params: { symbols: symbols?.join(',') } })
};

export const healthApi = {
  check: () => http.get('/health')
};

export default http;
