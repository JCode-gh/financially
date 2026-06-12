import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { stocksApi } from '../services/api.js';
import { getWsUrl } from '../config/api.js';
import { scheduleCloudSync, registerUserDataProvider } from '../services/userDataSync.js';

const WATCHLISTS_KEY = 'financially_watchlists';
const LEGACY_WATCHLIST_KEY = 'financially_watchlist';
const QUOTES_KEY = 'financially_watchlist_quotes';
export const STOCKS_VIEW_KEY = 'financially_stocks_view';

const LEGACY_SAMPLE_LISTS = [
  ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'JPM', 'BAC', 'GS'],
  ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'JPM', 'BAC', 'GS', 'V', 'MA', 'BRK-B', 'SPY', 'QQQ']
];

function isLegacySampleList(list) {
  if (!Array.isArray(list) || !list.length) return false;
  const norm = list.map(s => String(s).toUpperCase()).sort();
  return LEGACY_SAMPLE_LISTS.some(legacy => {
    const sample = legacy.slice().sort();
    return sample.length === norm.length && sample.every((s, i) => s === norm[i]);
  });
}

function newListId() {
  return `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeWatchlistsState(state) {
  if (!state?.lists?.length) return defaultWatchlistsState();
  const activeExists = state.lists.some(l => l.id === state.activeId);
  if (!activeExists) return { ...state, activeId: state.lists[0].id };
  return state;
}

function defaultWatchlistsState() {
  const id = newListId();
  return { activeId: id, lists: [{ id, name: 'My stocks', symbols: [], createdAt: Date.now() }] };
}

function loadWatchlistsState() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLISTS_KEY));
    if (saved?.lists?.length && saved.activeId) {
      const activeExists = saved.lists.some(l => l.id === saved.activeId);
      if (!activeExists) saved.activeId = saved.lists[0].id;
      return saved;
    }
  } catch { /* fall through */ }

  // Migrate from single-list format
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_WATCHLIST_KEY));
    if (Array.isArray(legacy)) {
      const symbols = isLegacySampleList(legacy) ? [] : legacy.map(s => String(s).toUpperCase());
      const id = newListId();
      const state = {
        activeId: id,
        lists: [{ id, name: 'My stocks', symbols, createdAt: Date.now() }]
      };
      localStorage.removeItem(LEGACY_WATCHLIST_KEY);
      persistWatchlistsState(state);
      return state;
    }
  } catch { /* fall through */ }

  return defaultWatchlistsState();
}

function persistWatchlistsState(state) {
  try { localStorage.setItem(WATCHLISTS_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function loadQuoteCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(QUOTES_KEY));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
    // Migrate legacy array format
    if (Array.isArray(saved)) {
      const map = {};
      for (const q of saved) {
        if (q?.symbol) map[q.symbol.toUpperCase()] = q;
      }
      persistQuoteCache(map);
      return map;
    }
  } catch { /* fall through */ }
  return {};
}

function persistQuoteCache(map) {
  try { localStorage.setItem(QUOTES_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function quotesForSymbols(symbols, cache) {
  const out = [];
  for (const sym of symbols) {
    const q = cache[String(sym).toUpperCase()];
    if (q) out.push(q);
  }
  return out;
}

export const useMarketStore = defineStore('market', () => {
  const initialState = loadWatchlistsState();
  const quoteCache = ref(loadQuoteCache());

  const watchlistsState = ref(initialState);
  const marketData = ref([]);
  const watchlistData = ref([]);
  const selectedSymbol = ref(null);
  const selectedQuote = ref(null);
  const historicalData = ref([]);
  const chartInterval = ref('1day');
  const searchResults = ref([]);
  const chartRange = ref('3M');
  const loading = ref({ market: false, watchlist: false, historical: false, quote: false });
  const lastUpdated = ref(null);
  const error = ref(null);
  const liveTick = ref(null);
  const liveConnected = ref(false);
  let liveWs = null;
  let liveReconnect = null;

  const watchlists = computed(() => watchlistsState.value.lists);
  const activeWatchlistId = computed(() => watchlistsState.value.activeId);
  const activeWatchlist = computed(() =>
    watchlistsState.value.lists.find(l => l.id === watchlistsState.value.activeId) || watchlistsState.value.lists[0]
  );
  const watchlistSymbols = computed(() => activeWatchlist.value?.symbols || []);
  const allWatchlistSymbols = computed(() => {
    const syms = new Set();
    for (const list of watchlistsState.value.lists) {
      for (const s of list.symbols) syms.add(String(s).toUpperCase());
    }
    return [...syms];
  });

  // Hydrate active list quotes from cache on startup
  watchlistData.value = quotesForSymbols(watchlistSymbols.value, quoteCache.value);

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

  function persistWatchlists() {
    persistWatchlistsState(watchlistsState.value);
    scheduleCloudSync();
  }

  function exportUserData() {
    let stocksView = 'list';
    try {
      const v = localStorage.getItem(STOCKS_VIEW_KEY);
      if (v === 'charts' || v === 'list') stocksView = v;
    } catch { /* ignore */ }
    return {
      watchlists: watchlistsState.value,
      quoteCache: quoteCache.value,
      stocksView
    };
  }

  function hydrateUserData(data) {
    if (data?.watchlists) {
      watchlistsState.value = normalizeWatchlistsState(data.watchlists);
      persistWatchlistsState(watchlistsState.value);
    }
    if (data?.quoteCache && typeof data.quoteCache === 'object') {
      quoteCache.value = data.quoteCache;
      persistQuoteCache(quoteCache.value);
    }
    if (data?.stocksView === 'charts' || data?.stocksView === 'list') {
      try { localStorage.setItem(STOCKS_VIEW_KEY, data.stocksView); } catch { /* ignore */ }
    }
    loadActiveFromCache();
    fetchWatchlist();
    syncLive();
  }

  registerUserDataProvider(exportUserData);

  function mergeQuotesIntoCache(quotes) {
    const next = { ...quoteCache.value };
    for (const q of quotes) {
      if (q?.symbol) next[q.symbol.toUpperCase()] = q;
    }
    quoteCache.value = next;
    persistQuoteCache(next);
    scheduleCloudSync();
  }

  function loadActiveFromCache() {
    watchlistData.value = quotesForSymbols(watchlistSymbols.value, quoteCache.value);
  }

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
    const symbols = watchlistSymbols.value;
    if (!symbols.length) {
      watchlistData.value = [];
      lastUpdated.value = new Date();
      return;
    }
    const hasCached = watchlistData.value.length > 0;
    if (!hasCached) loading.value.watchlist = true;
    try {
      const res = await stocksApi.watchlist(symbols);
      watchlistData.value = res.data.data || [];
      mergeQuotesIntoCache(watchlistData.value);
      lastUpdated.value = new Date();
      error.value = null;
    } catch (e) {
      if (!hasCached) error.value = 'Failed to load watchlist';
    } finally {
      loading.value.watchlist = false;
    }
  }

  let histReqId = 0;
  async function fetchHistorical(symbol, opts = {}) {
    if (typeof opts === 'number') opts = { days: opts };
    const days = opts.days ?? 63;
    const interval = opts.interval ?? chartInterval.value;
    chartInterval.value = interval;
    const reqId = ++histReqId;
    loading.value.historical = true;
    try {
      const res = await stocksApi.historical(symbol || selectedSymbol.value, days, interval);
      if (reqId !== histReqId) return;
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
    historicalData.value = [];
    syncLive();
    await fetchQuote(symbol);
  }

  async function resolveSymbol(input) {
    const sym = input.trim().toUpperCase();
    if (!sym) return sym;
    if (/\.[A-Z]{1,4}$/.test(sym)) return sym;
    try {
      const res = await stocksApi.resolve(sym);
      return res.data.data?.symbol || sym;
    } catch {
      return sym;
    }
  }

  function createWatchlist(name) {
    const trimmed = name.trim() || 'New list';
    const id = newListId();
    watchlistsState.value = {
      ...watchlistsState.value,
      activeId: id,
      lists: [...watchlistsState.value.lists, { id, name: trimmed, symbols: [], createdAt: Date.now() }]
    };
    persistWatchlists();
    loadActiveFromCache();
    fetchWatchlist();
    syncLive();
    return id;
  }

  function renameWatchlist(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    watchlistsState.value = {
      ...watchlistsState.value,
      lists: watchlistsState.value.lists.map(l => l.id === id ? { ...l, name: trimmed } : l)
    };
    persistWatchlists();
  }

  function deleteWatchlist(id) {
    if (watchlistsState.value.lists.length <= 1) return false;
    const wasActive = watchlistsState.value.activeId === id;
    const lists = watchlistsState.value.lists.filter(l => l.id !== id);
    const activeId = wasActive ? lists[0].id : watchlistsState.value.activeId;
    watchlistsState.value = { activeId, lists };
    persistWatchlists();
    if (wasActive) {
      loadActiveFromCache();
      fetchWatchlist();
    }
    syncLive();
    return true;
  }

  function setActiveWatchlist(id) {
    if (!watchlistsState.value.lists.some(l => l.id === id)) return;
    watchlistsState.value = { ...watchlistsState.value, activeId: id };
    persistWatchlists();
    loadActiveFromCache();
    fetchWatchlist();
  }

  function reorderWatchlists(fromIndex, toIndex) {
    const lists = [...watchlistsState.value.lists];
    if (fromIndex < 0 || fromIndex >= lists.length) return;
    if (toIndex < 0 || toIndex >= lists.length) return;
    if (fromIndex === toIndex) return;
    const [item] = lists.splice(fromIndex, 1);
    lists.splice(toIndex, 0, item);
    watchlistsState.value = { ...watchlistsState.value, lists };
    persistWatchlists();
  }

  async function addToWatchlist(symbol, listId) {
    const resolved = await resolveSymbol(symbol);
    const targetId = listId || activeWatchlistId.value;
    const list = watchlistsState.value.lists.find(l => l.id === targetId);
    if (!list || list.symbols.includes(resolved)) return resolved;

    watchlistsState.value = {
      ...watchlistsState.value,
      lists: watchlistsState.value.lists.map(l =>
        l.id === targetId ? { ...l, symbols: [...l.symbols, resolved] } : l
      )
    };
    persistWatchlists();
    if (targetId === activeWatchlistId.value) fetchWatchlist();
    syncLive();
    return resolved;
  }

  function removeFromWatchlist(symbol) {
    const id = activeWatchlistId.value;
    watchlistsState.value = {
      ...watchlistsState.value,
      lists: watchlistsState.value.lists.map(l =>
        l.id === id ? { ...l, symbols: l.symbols.filter(s => s !== symbol) } : l
      )
    };
    watchlistData.value = watchlistData.value.filter(s => s.symbol !== symbol);
    persistWatchlists();
    syncLive();
  }

  function liveSymbols() {
    const syms = new Set(allWatchlistSymbols.value.map(s => s.toUpperCase()));
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
    if (quoteCache.value[symbol]) apply(quoteCache.value[symbol]);
    apply(marketData.value.find(s => s.symbol === symbol));
    if (selectedQuote.value?.symbol === symbol) apply(selectedQuote.value);
    liveTick.value = { symbol, price, ts: Date.now() };
  }

  function connectLive() {
    if (typeof window === 'undefined') return;
    if (liveWs && (liveWs.readyState === 0 || liveWs.readyState === 1)) return;
    try {
      const wsUrl = getWsUrl();
      if (!wsUrl) return;
      liveWs = new WebSocket(wsUrl);
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

  async function init(opts = {}) {
    const { watchlistOnly = false } = opts;
    if (watchlistOnly) {
      await fetchWatchlist();
    } else {
      await Promise.all([fetchMarket(), fetchWatchlist()]);
    }
    if (selectedSymbol.value) {
      await fetchQuote(selectedSymbol.value);
    }
  }

  return {
    marketData, watchlistData, selectedSymbol, selectedQuote, historicalData, chartInterval,
    searchResults, watchlistSymbols, allWatchlistSymbols, watchlists, activeWatchlistId,
    activeWatchlist, chartRange, loading, lastUpdated, error,
    liveTick, liveConnected,
    selectedStock, topMovers,
    fetchMarket, fetchWatchlist, fetchHistorical, fetchQuote, searchSymbol, resolveSymbol,
    selectSymbol, addToWatchlist, removeFromWatchlist, createWatchlist, renameWatchlist,
    deleteWatchlist, setActiveWatchlist, reorderWatchlists, exportUserData, hydrateUserData, init,
    connectLive, disconnectLive, syncLive
  };
});
