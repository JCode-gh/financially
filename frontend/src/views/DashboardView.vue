<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <!-- Market indices ticker -->
    <MarketTicker />

    <!-- Main grid -->
    <div class="flex-1 grid min-h-0" style="grid-template-columns: 260px 1fr 280px; grid-template-rows: 1fr 190px; gap: 6px; padding: 6px;">

      <!-- Left: News Feed -->
      <div class="row-span-2 min-h-0 overflow-hidden">
        <NewsFeed />
      </div>

      <!-- Center top: Stock Chart -->
      <div class="min-h-0 overflow-hidden">
        <StockChart :symbol="selectedSymbol" />
      </div>

      <!-- Right: Watchlist -->
      <div class="row-span-2 min-h-0 overflow-hidden">
        <WatchList />
      </div>

      <!-- Center bottom: Accuracy + Predictions row -->
      <div class="grid min-h-0 overflow-hidden" style="grid-template-columns: 1fr 220px; gap: 6px;">
        <AccuracyTracker />
        <PredictionPanel />
      </div>
    </div>

    <!-- No backend notice -->
    <div v-if="backendDown" class="fixed bottom-4 right-4 bg-surface-100 border border-bear/40 text-bear text-xs font-mono px-4 py-3 rounded shadow-xl max-w-xs">
      <div class="font-semibold mb-1">Backend not connected</div>
      <div class="text-gray-400">Run <code class="text-accent">cd backend && npm run dev</code> to start the API server.</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useMarketStore } from '../stores/marketStore.js';
import { useNewsStore } from '../stores/newsStore.js';
import { usePredictionStore } from '../stores/predictionStore.js';
import { healthApi } from '../services/api.js';
import MarketTicker from '../components/layout/MarketTicker.vue';
import NewsFeed from '../components/news/NewsFeed.vue';
import StockChart from '../components/stocks/StockChart.vue';
import WatchList from '../components/stocks/WatchList.vue';
import AccuracyTracker from '../components/predictions/AccuracyTracker.vue';
import PredictionPanel from '../components/predictions/PredictionPanel.vue';

const marketStore = useMarketStore();
const newsStore = useNewsStore();
const predictionStore = usePredictionStore();

const selectedSymbol = computed(() => marketStore.selectedSymbol);
const backendDown = ref(false);
let refreshInterval;

async function checkBackend() {
  try {
    await healthApi.check();
    backendDown.value = false;
    return true;
  } catch {
    backendDown.value = true;
    return false;
  }
}

async function init() {
  const alive = await checkBackend();
  if (!alive) return;

  await Promise.all([
    marketStore.init(),
    newsStore.fetchMarketNews(),
    predictionStore.fetchAccuracy()
  ]);

  // Auto-load predictions for default symbol
  await predictionStore.fetchForSymbol(selectedSymbol.value);
}

onMounted(() => {
  init();
  // Refresh market data every 60 seconds
  refreshInterval = setInterval(async () => {
    await Promise.allSettled([
      marketStore.fetchMarket(),
      marketStore.fetchWatchlist()
    ]);
  }, 60_000);
});

onUnmounted(() => clearInterval(refreshInterval));
</script>
