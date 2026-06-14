import { Router } from 'express';
import { getMarketOverview, getQuote, getMultipleQuotes, searchSymbols as searchYahoo } from '../services/yahooFinance.js';
import { getFinnhubQuote, getMarketOverview as getFinnhubMarketOverview, searchSymbols as searchFinnhub } from '../services/finnhub.js';
import { getQuote as getAvQuote } from '../services/alphaVantage.js';
import { getHistoricalSeries, quoteFromDisk as historyQuoteFromDisk } from '../services/historyProvider.js';
import { getIntraday } from '../services/twelveData.js';
import { enrichSearchResult, pickBestSearchMatch, rankSearchResult } from '../services/symbolFormat.js';

const INTRADAY_INTERVALS = new Set(['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h']);

const router = Router();

async function quoteFromHistory(symbol) {
  const fromDisk = historyQuoteFromDisk(symbol);
  if (fromDisk) return fromDisk;
  const hist = await getHistoricalSeries(symbol, 5, 7 * 24 * 3600_000).catch(() => null);
  // #region agent log
  fetch('http://127.0.0.1:7933/ingest/484bf9b6-9aed-4f59-8451-4a6a892f0530',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d04438'},body:JSON.stringify({sessionId:'d04438',location:'stocks.js:quoteFromHistory',message:'history fallback',data:{symbol,fromDisk:!!fromDisk,histLen:hist?.length||0},timestamp:Date.now(),hypothesisId:'B,C'})}).catch(()=>{});
  // #endregion
  if (!hist?.length) return null;
  const last = hist[hist.length - 1];
  const prev = hist.length > 1 ? hist[hist.length - 2] : last;
  const change = last.close - prev.close;
  return {
    symbol,
    price: last.close,
    change,
    changePct: prev.close ? (change / prev.close) * 100 : 0,
    previousClose: prev.close,
    open: last.open,
    dayHigh: last.high,
    dayLow: last.low,
    volume: last.volume,
    stale: true
  };
}

router.get('/watchlist', async (req, res) => {
  const symbols = (req.query.symbols ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return res.json({ success: true, data: [] });
  try {
    let data = await getMultipleQuotes(symbols);
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/484bf9b6-9aed-4f59-8451-4a6a892f0530',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d04438'},body:JSON.stringify({sessionId:'d04438',location:'stocks.js:watchlist:multi',message:'getMultipleQuotes result',data:{symbols,count:data?.length||0,returned:data?.map(q=>q.symbol)||[]},timestamp:Date.now(),hypothesisId:'A,B'})}).catch(()=>{});
    // #endregion

    // Fill any symbols Yahoo missed (rate limits, etc.)
    const have = new Set((data || []).map(q => q.symbol));
    const missing = symbols.filter(s => !have.has(s));
    if (missing.length) {
      const extras = await Promise.all(
        missing.map(async sym => {
          const q = await getQuote(sym).catch(() => null);
          const hist = q ? null : await quoteFromHistory(sym);
          // #region agent log
          fetch('http://127.0.0.1:7933/ingest/484bf9b6-9aed-4f59-8451-4a6a892f0530',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d04438'},body:JSON.stringify({sessionId:'d04438',location:'stocks.js:watchlist:fallback',message:'per-symbol fallback',data:{sym,fromGetQuote:!!q,fromHistory:!!hist,stale:q?.stale||hist?.stale||false},timestamp:Date.now(),hypothesisId:'B,C'})}).catch(()=>{});
          // #endregion
          return q || hist;
        })
      );
      data = [...(data || []), ...extras.filter(Boolean)];
    }

    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/484bf9b6-9aed-4f59-8451-4a6a892f0530',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d04438'},body:JSON.stringify({sessionId:'d04438',location:'stocks.js:watchlist:final',message:'watchlist response',data:{symbols,finalCount:data?.length||0,ok:!!data?.length},timestamp:Date.now(),hypothesisId:'A,B,C,D,E'})}).catch(()=>{});
    // #endregion
    if (data?.length) return res.json({ success: true, data });
    return res.status(503).json({ success: false, error: 'Quote data unavailable' });
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/484bf9b6-9aed-4f59-8451-4a6a892f0530',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d04438'},body:JSON.stringify({sessionId:'d04438',location:'stocks.js:watchlist:catch',message:'watchlist threw',data:{symbols,error:err?.message||String(err)},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return res.status(503).json({ success: false, error: 'Quote data unavailable' });
  }
});

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

router.get('/quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    let data = await getQuote(symbol);
    // Finnhub free tier is US-only; only use as fallback for plain US tickers
    if (!data && !symbol.includes('.')) data = await getFinnhubQuote(symbol);
    if (!data) data = await getAvQuote(symbol);
    if (!data) data = await quoteFromHistory(symbol);
    if (data) return res.json({ success: true, data });
    return res.status(503).json({ success: false, error: `Quote unavailable for ${symbol}` });
  } catch {
    return res.status(503).json({ success: false, error: `Quote unavailable for ${symbol}` });
  }
});

router.get('/historical/:symbol', async (req, res) => {
  const symbol = decodeURIComponent(req.params.symbol).toUpperCase();
  const interval = req.query.interval || '1day';
  try {
    let data;
    if (INTRADAY_INTERVALS.has(interval)) {
      const bars = Math.min(2000, parseInt(req.query.days || '500', 10));
      data = await getIntraday(symbol, interval, bars);
    } else {
      const days = Math.min(5000, parseInt(req.query.days || '100', 10));
      // Accept day-old cache on server — avoids 503 when Yahoo rate-limits Railway IPs
      data = await getHistoricalSeries(symbol, days, 24 * 3600_000);
      if (!data?.length) {
        const { getHistorical: getStooqHist } = await import('../services/stooq.js');
        data = await getStooqHist(symbol, days).catch(() => null);
      }
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
    // Yahoo first — best international coverage (ABI.BR, INGA.AS, etc.).
    // Merge with Finnhub and dedupe so US + global results both appear.
    const [yahoo, finnhub] = await Promise.all([
      searchYahoo(q).catch(() => []),
      searchFinnhub(q).catch(() => [])
    ]);
    const seen = new Set();
    const data = [];
    for (const r of [...yahoo, ...finnhub]) {
      if (!r?.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      data.push(enrichSearchResult(r));
    }
    data.sort((a, b) => rankSearchResult(q, b) - rankSearchResult(q, a));
    res.json({ success: true, data: data.slice(0, 15) });
  } catch {
    res.json({ success: true, data: [] });
  }
});

router.get('/resolve', async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) return res.json({ success: true, data: null });
  const input = q.trim().toUpperCase();
  try {
    const [yahoo, finnhub] = await Promise.all([
      searchYahoo(q).catch(() => []),
      searchFinnhub(q).catch(() => [])
    ]);
    const seen = new Set();
    const results = [];
    for (const r of [...yahoo, ...finnhub]) {
      if (!r?.symbol || seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      results.push(enrichSearchResult(r));
    }
    const symbol = pickBestSearchMatch(input, results) || input;
    const match = results.find(r => r.symbol === symbol) || null;
    res.json({ success: true, data: { symbol, match, alternatives: results.slice(0, 8) } });
  } catch {
    res.json({ success: true, data: { symbol: input, match: null, alternatives: [] } });
  }
});

export default router;
