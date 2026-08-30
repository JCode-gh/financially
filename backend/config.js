const extraOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3001),
  corsExtra: extraOrigins,
  keys: {
    finnhub: !!process.env.FINNHUB_API_KEY,
    newsApi: !!process.env.NEWS_API_KEY,
    alphaVantage: !!process.env.ALPHA_VANTAGE_KEY,
    twelveData: !!process.env.TWELVE_DATA_KEY
  },
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:7b'
  }
};

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*jcode\.be$/i.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*netlify\.app$/i.test(origin)) return true;
  return config.corsExtra.includes(origin);
}
