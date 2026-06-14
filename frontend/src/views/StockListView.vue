<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <WatchlistTabs />

    <div class="flex items-center justify-between px-4 py-3 border-b border-surface-300 flex-shrink-0 gap-3">
      <h1 class="text-sm font-medium text-gray-300">{{ activeListName }}</h1>
      <div class="flex items-center gap-2 flex-shrink-0">
        <div class="flex items-center rounded border border-surface-300 overflow-hidden">
          <button
            @click="setViewMode('list')"
            class="text-xs px-2.5 py-1 font-mono transition-colors"
            :class="viewMode === 'list' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >
            List
          </button>
          <button
            @click="setViewMode('charts')"
            class="text-xs px-2.5 py-1 font-mono transition-colors border-l border-surface-300"
            :class="viewMode === 'charts' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >
            Charts
          </button>
        </div>
        <button
          @click="showAdd = !showAdd"
          class="text-xs text-accent hover:text-accent/70 font-mono"
        >
          + Add stock
        </button>
      </div>
    </div>

    <div v-if="showAdd" class="px-4 py-2 border-b border-surface-300/50 flex-shrink-0">
      <div class="flex gap-2">
        <div class="relative flex-1">
          <input
            v-model="newSymbol"
            @input="onAddSearch"
            @keydown.enter="addSymbol"
            @keydown.escape="closeAdd"
            placeholder="Search by name or ticker (e.g. WEBN, KBC Ancora)"
            class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50"
            autofocus
          />
          <div
            v-if="addSearchResults.length > 0"
            class="absolute top-full left-0 right-0 mt-1 bg-surface-200 border border-surface-300 rounded shadow-xl z-50 max-h-64 overflow-y-auto"
          >
            <button
              v-for="r in addSearchResults.slice(0, 10)"
              :key="r.symbol"
              @click="pickSearchResult(r)"
              class="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-surface-300 text-left border-b border-surface-300/40 last:border-0"
            >
              <div class="flex-shrink-0">
                <div class="font-mono text-accent font-semibold text-sm">{{ r.symbol }}</div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <span v-if="r.market" class="text-[10px] text-gray-500 font-mono">{{ r.market }}</span>
                  <span v-if="r.type === 'ETF'" class="text-[10px] text-accent/80 font-mono px-1 rounded bg-accent/10">ETF</span>
                </div>
              </div>
              <div class="text-gray-400 text-xs leading-snug min-w-0">{{ r.name }}</div>
            </button>
          </div>
        </div>
        <button @click="addSymbol" class="px-4 py-2 text-sm text-accent font-mono hover:text-accent/70 flex-shrink-0">Add</button>
      </div>
      <p v-if="addError" class="text-xs text-neutral mt-1.5 font-mono">{{ addError }}</p>
    </div>

    <div class="flex-1 overflow-y-auto panel-scroll">
      <div v-if="loading" class="flex items-center justify-center h-32">
        <div class="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>

      <div v-else-if="!marketStore.watchlistSymbols.length" class="flex flex-col items-center justify-center h-40 text-gray-500 text-sm gap-2">
        <span>This list is empty</span>
        <span class="text-xs text-gray-600">Search or add stocks to {{ activeListName }}</span>
        <button @click="showAdd = true" class="text-accent text-xs mt-1">+ Add a stock</button>
      </div>

      <div v-else-if="viewMode === 'charts'" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 p-2">
        <MiniStockChart
          v-for="(stock, idx) in gridStocks"
          :key="stock.symbol"
          :symbol="stock.symbol"
          :quote="stock"
          :stagger-index="idx"
        />
      </div>

      <template v-else>
      <div
        v-for="stock in watchlist"
        :key="stock.symbol"
        class="flex items-center border-b border-surface-300/30 hover:bg-surface-200/40 transition-colors group"
      >
        <button
          @click="openStock(stock.symbol)"
          class="flex-1 flex items-center gap-4 px-4 py-4 text-left min-w-0"
        >
          <div class="flex-1 min-w-0">
            <div class="font-mono text-base font-semibold text-white">{{ stock.symbol }}</div>
            <div class="text-sm text-gray-500 truncate">{{ stock.name }}</div>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="font-mono text-base text-gray-200">${{ (stock.price || 0).toFixed(2) }}</div>
            <div class="font-mono text-sm" :class="(stock.changePct || 0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ (stock.changePct || 0) >= 0 ? '+' : '' }}{{ (stock.changePct || 0).toFixed(2) }}%
            </div>
          </div>
        </button>
        <button
          @click="removeStock(stock.symbol)"
          class="px-4 py-4 text-gray-600 hover:text-bear transition-colors flex-shrink-0"
          title="Remove from list"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      </template>
    </div>

    <div v-if="backendDown" class="px-4 py-3 border-t border-bear/30 bg-bear/5 text-bear text-xs">
      Backend not connected — run <code class="text-accent">cd backend && npm run dev</code>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useMarketStore, STOCKS_VIEW_KEY } from '../stores/marketStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { scheduleCloudSync } from '../services/userDataSync.js';
import { healthApi, stocksApi } from '../services/api.js';
import WatchlistTabs from '../components/stocks/WatchlistTabs.vue';
import MiniStockChart from '../components/stocks/MiniStockChart.vue';

const VIEW_MODE_KEY = STOCKS_VIEW_KEY;

function loadViewMode() {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === 'charts' || v === 'list') return v;
  } catch { /* ignore */ }
  return 'list';
}

const router = useRouter();
const marketStore = useMarketStore();
const authStore = useAuthStore();

const showAdd = ref(false);
const viewMode = ref(loadViewMode());
const newSymbol = ref('');
const addSearchResults = ref([]);
const addError = ref('');
const backendDown = ref(false);
let refreshInterval;
let addSearchTimer;

const watchlist = computed(() => marketStore.watchlistData);
const activeListName = computed(() => marketStore.activeWatchlist?.name || 'My stocks');
const loading = computed(() =>
  viewMode.value === 'list' &&
  marketStore.loading.watchlist &&
  marketStore.watchlistSymbols.length > 0 &&
  !watchlist.value.length
);

const gridStocks = computed(() => {
  if (watchlist.value.length) return watchlist.value;
  return marketStore.watchlistSymbols.map(sym => ({ symbol: sym, name: sym, price: null, changePct: null }));
});

function setViewMode(mode) {
  viewMode.value = mode;
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
  scheduleCloudSync();
}

watch(() => authStore.syncing, (syncing, wasSyncing) => {
  if (wasSyncing && !syncing && authStore.isLoggedIn) {
    viewMode.value = loadViewMode();
  }
});

function onAddSearch() {
  clearTimeout(addSearchTimer);
  addError.value = '';
  addSearchTimer = setTimeout(async () => {
    const q = newSymbol.value.trim();
    if (!q) {
      addSearchResults.value = [];
      return;
    }
    try {
      const res = await stocksApi.search(q);
      addSearchResults.value = res.data.data || [];
    } catch {
      addSearchResults.value = [];
    }
  }, 300);
}

function closeAdd() {
  showAdd.value = false;
  newSymbol.value = '';
  addSearchResults.value = [];
  addError.value = '';
}

async function pickSearchResult(r) {
  addSearchResults.value = [];
  newSymbol.value = r.symbol;
  await addToList(r.symbol);
}

async function addToList(raw) {
  addError.value = '';
  const resolved = await marketStore.addToWatchlist(raw);
  if (!resolved) {
    addError.value = 'Quote data unavailable for this symbol';
    return null;
  }
  newSymbol.value = '';
  showAdd.value = false;
  addSearchResults.value = [];
  return resolved;
}

function openStock(symbol) {
  router.push({ name: 'stock', params: { symbol } });
}

function removeStock(symbol) {
  marketStore.removeFromWatchlist(symbol);
}

async function addSymbol() {
  const raw = newSymbol.value.trim();
  if (!raw) return;
  const resolved = await addToList(raw);
  if (resolved !== raw.toUpperCase()) {
    router.push({ name: 'stock', params: { symbol: resolved } });
  }
}

onMounted(async () => {
  marketStore.connectLive();
  const loadPromise = marketStore.init({ watchlistOnly: true });

  try {
    await Promise.all([healthApi.check(), loadPromise]);
    backendDown.value = false;
  } catch {
    backendDown.value = true;
  }

  refreshInterval = setInterval(() => {
    marketStore.fetchWatchlist();
  }, 60_000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
  clearTimeout(addSearchTimer);
  marketStore.disconnectLive();
});
</script>
