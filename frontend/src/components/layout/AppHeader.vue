<template>
  <header class="bg-surface-100 border-b border-surface-300 px-4 h-12 flex items-center justify-between gap-4 flex-shrink-0">
    <!-- Logo -->
    <div class="flex items-center gap-2 flex-shrink-0">
      <svg class="w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
        <polyline points="16 7 22 7 22 13"></polyline>
      </svg>
      <span class="text-white font-bold text-base tracking-tight">FINANCIALLY</span>
      <span class="text-xs text-gray-500 font-mono hidden sm:block">Market Intelligence</span>
    </div>

    <!-- Search -->
    <div class="relative flex-1 max-w-xs">
      <input
        v-model="searchQuery"
        @input="onSearch"
        @keydown.escape="clearSearch"
        placeholder="Search stocks..."
        class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent/50 font-mono"
      />
      <div v-if="searchResults.length > 0" class="absolute top-full left-0 right-0 mt-1 bg-surface-200 border border-surface-300 rounded shadow-xl z-50">
        <button
          v-for="r in searchResults.slice(0, 6)"
          :key="r.symbol"
          @click="selectResult(r)"
          class="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-300 text-left text-sm"
        >
          <span class="font-mono text-accent font-semibold">{{ r.symbol }}</span>
          <span class="text-gray-400 truncate text-xs">{{ r.name }}</span>
          <span class="ml-auto text-xs text-gray-500">{{ r.exchange }}</span>
        </button>
      </div>
    </div>

    <!-- Controls -->
    <div class="flex items-center gap-3 flex-shrink-0">
      <!-- Refresh -->
      <button
        @click="refresh"
        :class="refreshing ? 'animate-spin' : ''"
        class="text-gray-400 hover:text-accent transition-colors"
        title="Refresh all data"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>

      <!-- Model health -->
      <div class="flex items-center gap-1.5 text-xs font-mono">
        <span class="text-gray-500">MODEL</span>
        <span :class="healthColor">{{ modelHealth }}</span>
      </div>

      <!-- Overall accuracy -->
      <div v-if="overallAccuracy" class="hidden sm:flex items-center gap-1 text-xs font-mono">
        <span class="text-gray-500">ACC</span>
        <span class="text-accent font-semibold">{{ overallAccuracy }}%</span>
      </div>

      <!-- Auto-refresh indicator -->
      <div class="flex items-center gap-1.5 text-xs text-gray-500 font-mono hidden md:flex">
        <span class="live-dot"></span>
        <span>{{ lastUpdated || 'Loading...' }}</span>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useMarketStore } from '../../stores/marketStore.js';
import { useNewsStore } from '../../stores/newsStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';

const marketStore = useMarketStore();
const newsStore = useNewsStore();
const predictionStore = usePredictionStore();

const searchQuery = ref('');
const refreshing = ref(false);

const searchResults = computed(() => marketStore.searchResults);
const overallAccuracy = computed(() => predictionStore.overallAccuracy);
const modelHealth = computed(() => predictionStore.modelHealth);
const healthColor = computed(() => ({
  excellent: 'text-bull font-semibold',
  good: 'text-bull/70',
  fair: 'text-neutral',
  poor: 'text-bear',
  learning: 'text-accent',
  unknown: 'text-gray-500'
}[modelHealth.value] || 'text-gray-500'));

const lastUpdated = computed(() => {
  if (!marketStore.lastUpdated) return null;
  return marketStore.lastUpdated.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
});

let searchTimer;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => marketStore.searchSymbol(searchQuery.value), 300);
}

function clearSearch() {
  searchQuery.value = '';
  marketStore.searchResults = [];
}

async function selectResult(r) {
  clearSearch();
  await marketStore.selectSymbol(r.symbol);
}

async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  await Promise.all([
    marketStore.fetchMarket(),
    marketStore.fetchWatchlist(),
    marketStore.fetchHistorical(marketStore.selectedSymbol),
    newsStore.fetchMarketNews()
  ]);
  setTimeout(() => { refreshing.value = false; }, 800);
}
</script>
