import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 15000
});

// Stocks
export const stocksApi = {
  market: () => http.get('/stocks/market'),
  watchlist: (symbols) => http.get('/stocks/watchlist', { params: { symbols: symbols?.join(',') } }),
  quote: (symbol) => http.get(`/stocks/quote/${symbol}`),
  historical: (symbol, days = 100, interval = '1day') => http.get(`/stocks/historical/${symbol}`, { params: { days, interval } }),
  search: (q) => http.get('/stocks/search', { params: { q } })
};

// News
export const newsApi = {
  market: () => http.get('/news/market'),
  stock: (symbol, name) => http.get(`/news/stock/${symbol}`, { params: { name } })
};

// Predictions
export const predictionsApi = {
  accuracy: () => http.get('/predictions/accuracy'),
  history: (params) => http.get('/predictions/history', { params }),
  forSymbol: (symbol) => http.get(`/predictions/${symbol}`),
  generate: (symbol) => http.post(`/predictions/generate/${symbol}`),
  evaluate: () => http.post('/predictions/evaluate')
};

// Health
export const healthApi = {
  check: () => http.get('/health')
};

export default http;
