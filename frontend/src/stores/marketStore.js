import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { stocksApi } from '../services/api.js';

const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'JPM', 'BAC', 'GS'];

export const useMarketStore = defineStore('market', () => {
  const marketData = ref([]);
  const watchlistData = ref([]);
  const selectedSymbol = ref('AAPL');
  const selectedQuote = ref(null);
  const historicalData = ref([]);
  const chartInterval = ref('1day');
  const searchResults = ref([]);
  const watchlistSymbols = ref([...DEFAULT_WATCHLIST]);
  const chartRange = ref('3M');
  const loading = ref({ market: false, watchlist: false, historical: false, quote: false });
  const lastUpdated = ref(null);
  const error = ref(null);
  const liveTick = ref(null);        // latest streamed trade { symbol, price, ts }
  const liveConnected = ref(false);
  let liveWs = null;
  let liveReconnect = null;

  const selectedStock = computed(() =>
    watchlistData.value.find(s => s.symbol === selectedSymbol.value) || selectedQuote.value
  );

  const topMovers = computed(() => {
    if (!watchlistData.value.length) return { gainers: [], losers: [] };
    const sorted = [...watchlistData.value].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
    return {
      gainers: sorted.filter(s => (s.changePct || 0) > 0).slice(0, 3),
      losers: sorted.filter(s => (s.changePct || 0) < 0).slice(-3).reverse()
    };
  });

  async function fetchMarket() {
    loading.value.market = true;
    try {
      const res = await stocksApi.market();
      marketData.value = res.data.data || [];
    } catch (e) {
      error.value = 'Failed to load market data';
    } finally {
      loading.value.market = false;
    }
  }

  async function fetchWatchlist() {
    loading.value.watchlist = true;
    try {
      const res = await stocksApi.watchlist(watchlistSymbols.value);
      watchlistData.value = res.data.data || [];
      lastUpdated.value = new Date();
    } catch (e) {
      error.value = 'Failed to load watchlist';
    } finally {
      loading.value.watchlist = false;
    }
  }

  let histReqId = 0; // guards against out-of-order responses (slow fetch landing after a newer one)
  async function fetchHistorical(symbol, opts = {}) {
    if (typeof opts === 'number') opts = { days: opts }; // tolerate legacy numeric arg
    const days = opts.days ?? 63;
    const interval = opts.interval ?? chartInterval.value;
    chartInterval.value = interval;
    const reqId = ++histReqId;
    loading.value.historical = true;
    // Don't clear historicalData here — keep previous candles visible while loading
    try {
      const res = await stocksApi.historical(symbol || selectedSymbol.value, days, interval);
      if (reqId !== histReqId) return; // a newer request superseded this one — ignore stale response
      if (res.data.success === false) {
        error.value = res.data.error || 'Chart data unavailable';
      } else {
        historicalData.value = res.data.data || [];
        error.value = null;
      }
    } catch (e) {
      if (reqId === histReqId) error.value = 'Failed to load chart data';
    } finally {
      if (reqId === histReqId) loading.value.historical = false;
    }
  }

  async function fetchQuote(symbol) {
    loading.value.quote = true;
    try {
      const res = await stocksApi.quote(symbol);
      selectedQuote.value = res.data.data;
    } catch (e) {
      error.value = 'Failed to load quote';
    } finally {
      loading.value.quote = false;
    }
  }

  async function searchSymbol(query) {
    if (!query.trim()) { searchResults.value = []; return; }
    try {
      const res = await stocksApi.search(query);
      searchResults.value = res.data.data || [];
    } catch { searchResults.value = []; }
  }

  async function selectSymbol(symbol) {
    selectedSymbol.value = symbol;
    historicalData.value = []; // Clear when changing symbol, not when changing range
    syncLive(); // stream the newly selected symbol
    // Use current chartRange to determine days
    const rangeDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = rangeDays[chartRange.value] || 90;
    await Promise.all([fetchHistorical(symbol, days), fetchQuote(symbol)]);
  }

  function addToWatchlist(symbol) {
    if (!watchlistSymbols.value.includes(symbol)) {
      watchlistSymbols.value.push(symbol);
      fetchWatchlist();
      syncLive();
    }
  }

  function removeFromWatchlist(symbol) {
    watchlistSymbols.value = watchlistSymbols.value.filter(s => s !== symbol);
    watchlistData.value = watchlistData.value.filter(s => s.symbol !== symbol);
    syncLive();
  }

  // ---- Live streaming (Finnhub trades via backend /ws proxy) ----
  function liveSymbols() {
    const syms = new Set(watchlistSymbols.value.map(s => s.toUpperCase()));
    if (selectedSymbol.value) syms.add(selectedSymbol.value.toUpperCase());
    for (const m of marketData.value) if (m.type === 'crypto' && m.symbol) syms.add(m.symbol.toUpperCase());
    return [...syms];
  }

  function syncLive() {
    if (liveWs && liveWs.readyState === 1) {
      liveWs.send(JSON.stringify({ action: 'set', symbols: liveSymbols() }));
    }
  }

  function applyTick(symbol, price) {
    const apply = (q) => {
      if (!q) return;
      q.price = price;
      if (q.previousClose) {
        q.change = price - q.previousClose;
        q.changePct = (q.change / q.previousClose) * 100;
      }
    };
    apply(watchlistData.value.find(s => s.symbol === symbol));
    apply(marketData.value.find(s => s.symbol === symbol));
    if (selectedQuote.value?.symbol === symbol) apply(selectedQuote.value);
    liveTick.value = { symbol, price, ts: Date.now() };
  }

  function connectLive() {
    if (typeof window === 'undefined') return;
    if (liveWs && (liveWs.readyState === 0 || liveWs.readyState === 1)) return; // already connecting/open
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      liveWs = new WebSocket(`${proto}//${location.host}/ws`);
      liveWs.onopen = () => { liveConnected.value = true; syncLive(); };
      liveWs.onmessage = (e) => {
        let d;
        try { d = JSON.parse(e.data); } catch { return; }
        if (d.type === 'trade') applyTick(d.symbol, d.price);
      };
      liveWs.onclose = () => { liveConnected.value = false; liveReconnect = setTimeout(connectLive, 3000); };
      liveWs.onerror = () => { try { liveWs.close(); } catch { /* ignore */ } };
    } catch { /* ignore */ }
  }

  function disconnectLive() {
    if (liveReconnect) clearTimeout(liveReconnect);
    if (liveWs) { try { liveWs.onclose = null; liveWs.close(); } catch { /* ignore */ } liveWs = null; }
    liveConnected.value = false;
  }

  async function init() {
    await Promise.all([fetchMarket(), fetchWatchlist()]);
    const rangeDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = rangeDays[chartRange.value] || 90;
    await fetchHistorical(selectedSymbol.value, days);
    await fetchQuote(selectedSymbol.value);
  }

  return {
    marketData, watchlistData, selectedSymbol, selectedQuote, historicalData, chartInterval,
    searchResults, watchlistSymbols, chartRange, loading, lastUpdated, error,
    liveTick, liveConnected,
    selectedStock, topMovers,
    fetchMarket, fetchWatchlist, fetchHistorical, fetchQuote, searchSymbol,
    selectSymbol, addToWatchlist, removeFromWatchlist, init,
    connectLive, disconnectLive, syncLive
  };
});
