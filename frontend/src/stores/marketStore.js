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

  async function fetchHistorical(symbol, opts = {}) {
    if (typeof opts === 'number') opts = { days: opts }; // tolerate legacy numeric arg
    const days = opts.days ?? 63;
    const interval = opts.interval ?? chartInterval.value;
    chartInterval.value = interval;
    loading.value.historical = true;
    // Don't clear historicalData here — keep previous candles visible while loading
    try {
      const res = await stocksApi.historical(symbol || selectedSymbol.value, days, interval);
      if (res.data.success === false) {
        error.value = res.data.error || 'Chart data unavailable';
      } else {
        historicalData.value = res.data.data || [];
        error.value = null;
      }
    } catch (e) {
      error.value = 'Failed to load chart data';
    } finally {
      loading.value.historical = false;
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
    // Use current chartRange to determine days
    const rangeDays = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
    const days = rangeDays[chartRange.value] || 90;
    await Promise.all([fetchHistorical(symbol, days), fetchQuote(symbol)]);
  }

  function addToWatchlist(symbol) {
    if (!watchlistSymbols.value.includes(symbol)) {
      watchlistSymbols.value.push(symbol);
      fetchWatchlist();
    }
  }

  function removeFromWatchlist(symbol) {
    watchlistSymbols.value = watchlistSymbols.value.filter(s => s !== symbol);
    watchlistData.value = watchlistData.value.filter(s => s.symbol !== symbol);
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
    selectedStock, topMovers,
    fetchMarket, fetchWatchlist, fetchHistorical, fetchQuote, searchSymbol,
    selectSymbol, addToWatchlist, removeFromWatchlist, init
  };
});
