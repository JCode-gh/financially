import axios from 'axios';
import { API_BASE_URL } from '../config/api.js';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000
});

function symPath(symbol) {
  return encodeURIComponent(String(symbol).trim());
}

// Stocks
export const stocksApi = {
  market: () => http.get('/stocks/market'),
  watchlist: (symbols) => http.get('/stocks/watchlist', { params: { symbols: symbols?.join(',') } }),
  quote: (symbol) => http.get(`/stocks/quote/${symPath(symbol)}`),
  historical: (symbol, days = 100, interval = '1day') =>
    http.get(`/stocks/historical/${symPath(symbol)}`, { params: { days, interval } }),
  search: (q) => http.get('/stocks/search', { params: { q } }),
  resolve: (q) => http.get('/stocks/resolve', { params: { q } })
};

// News
export const newsApi = {
  market: () => http.get('/news/market'),
  stock: (symbol, name) => http.get(`/news/stock/${symPath(symbol)}`, { params: { name } })
};

// Predictions
export const predictionsApi = {
  accuracy: () => http.get('/predictions/accuracy'),
  history: (params) => http.get('/predictions/history', { params }),
  forSymbol: (symbol) => http.get(`/predictions/${symPath(symbol)}`),
  generate: (symbol) => http.post(`/predictions/generate/${symPath(symbol)}`),
  evaluate: () => http.post('/predictions/evaluate'),
  backtest: () => http.post('/predictions/backtest')
};

// Scanner (auto opportunities, alerts, earnings calendar)
export const scannerApi = {
  latest: () => http.get('/scanner/latest'),
  run: (symbols) => http.post('/scanner/run', symbols ? { symbols } : {}),
  alerts: (limit = 30) => http.get('/scanner/alerts', { params: { limit } }),
  earnings: (symbols) => http.get('/scanner/earnings', { params: { symbols: symbols?.join(',') } })
};

// Health
export const healthApi = {
  check: () => http.get('/health')
};

export default http;
