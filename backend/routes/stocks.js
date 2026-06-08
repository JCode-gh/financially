import { Router } from 'express';
import { getMarketOverview, getQuote, getMultipleQuotes, searchSymbols as searchYahoo } from '../services/yahooFinance.js';
import { getFinnhubQuote, getMarketOverview as getFinnhubMarketOverview, searchSymbols as searchFinnhub } from '../services/finnhub.js';
import { getQuote as getAvQuote } from '../services/alphaVantage.js';
import { getHistoricalSeries } from '../services/historyProvider.js';
import { getIntraday } from '../services/twelveData.js';

const INTRADAY_INTERVALS = new Set(['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h']);

const router = Router();

const DEFAULT_WATCHLIST = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  'JPM', 'BAC', 'GS', 'V', 'MA', 'BRK-B', 'SPY', 'QQQ'
];

router.get('/market', async (req, res) => {
  try {
    let data = await getMarketOverview();
    if (!data?.length) data = await getFinnhubMarketOverview();
    if (data?.length) return res.json({ success: true, data });
    return res.status(503).json({ success: false, error: 'Market data unavailable' });
  } catch {
    return res.status(503).json({ success: false, error: 'Market data unavailable' });
  }
});

router.get('/watchlist', async (req, res) => {
  const symbols = (req.query.symbols || DEFAULT_WATCHLIST.join(','))
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  try {
    let data = await getMultipleQuotes(symbols);

    // Fill in missing symbols from Finnhub
    if (!data?.length) {
      const tasks = symbols.map(sym => () =>
        getFinnhubQuote(sym).then(q => q ? { ...q, symbol: sym } : null).catch(() => null)
      );
      const results = await Promise.allSettled(tasks.map(fn => fn()));
      data = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    }

    if (data?.length) return res.json({ success: true, data, defaultSymbols: DEFAULT_WATCHLIST });
    return res.status(503).json({ success: false, error: 'Quote data unavailable' });
  } catch {
    return res.status(503).json({ success: false, error: 'Quote data unavailable' });
  }
});

router.get('/quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    let data = await getQuote(symbol);
    if (!data) data = await getFinnhubQuote(symbol);
    if (!data) data = await getAvQuote(symbol);
    if (data) return res.json({ success: true, data });
    return res.status(503).json({ success: false, error: `Quote unavailable for ${symbol}` });
  } catch {
    return res.status(503).json({ success: false, error: `Quote unavailable for ${symbol}` });
  }
});

router.get('/historical/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const interval = req.query.interval || '1day';
  try {
    let data;
    if (INTRADAY_INTERVALS.has(interval)) {
      // Intraday bars (Twelve Data) — bypass the daily disk cache; these move constantly.
      const bars = Math.min(2000, parseInt(req.query.days || '500', 10));
      data = await getIntraday(symbol, interval, bars);
    } else {
      // Daily: persistent multi-source provider (Twelve Data → Yahoo → Alpha Vantage),
      // merged into a disk cache so every range slices one accumulated series.
      const days = Math.min(5000, parseInt(req.query.days || '100', 10));
      data = await getHistoricalSeries(symbol, days);
    }
    if (data?.length) return res.json({ success: true, data, interval });
    return res.status(503).json({ success: false, error: `Historical data unavailable for ${symbol}` });
  } catch {
    return res.status(503).json({ success: false, error: `Historical data unavailable for ${symbol}` });
  }
});

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ success: true, data: [] });
  try {
    // Try Finnhub first (always works), fallback to Yahoo if empty
    let data = await searchFinnhub(q);
    if (!data?.length) data = await searchYahoo(q);
    res.json({ success: true, data: data || [] });
  } catch {
    res.json({ success: true, data: [] });
  }
});

export default router;
