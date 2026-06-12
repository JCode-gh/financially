<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <!-- Market indices ticker -->
    <MarketTicker />

    <!-- Main grid -->
    <div class="flex-1 dash-grid min-h-0">

      <!-- Left: News Feed -->
      <div class="news-area min-h-0 overflow-hidden">
        <NewsFeed />
      </div>

      <!-- Center top: Stock Chart -->
      <div class="chart-area min-h-0 overflow-hidden">
        <StockChart :symbol="selectedSymbol" />
      </div>

      <!-- Right: Watchlist + Alerts -->
      <div class="watch-area min-h-0 overflow-hidden flex flex-col gap-1.5">
        <div class="flex-[3] min-h-0">
          <WatchList />
        </div>
        <div class="flex-[2] min-h-0">
          <AlertsPanel />
        </div>
      </div>

      <!-- Center bottom: Opportunities (auto-scanner) + Predictions -->
      <div class="bottom-area grid min-h-0 overflow-hidden">
        <OpportunitiesPanel />
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMarketStore } from '../stores/marketStore.js';
import { useNewsStore } from '../stores/newsStore.js';
import { usePredictionStore } from '../stores/predictionStore.js';
import { useScannerStore } from '../stores/scannerStore.js';
import { healthApi } from '../services/api.js';
import MarketTicker from '../components/layout/MarketTicker.vue';
import NewsFeed from '../components/news/NewsFeed.vue';
import StockChart from '../components/stocks/StockChart.vue';
import WatchList from '../components/stocks/WatchList.vue';
import OpportunitiesPanel from '../components/scanner/OpportunitiesPanel.vue';
import AlertsPanel from '../components/scanner/AlertsPanel.vue';
import PredictionPanel from '../components/predictions/PredictionPanel.vue';

const marketStore = useMarketStore();
const newsStore = useNewsStore();
const predictionStore = usePredictionStore();
const scannerStore = useScannerStore();

const selectedSymbol = computed(() => marketStore.selectedSymbol);
const backendDown = ref(false);
let refreshInterval;
let scannerInterval;

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

  // Auto-scanner results, alerts, earnings calendar — the board fills itself
  scannerStore.init();

  // Open the live trade stream (chart + prices update in real time)
  marketStore.connectLive();

  // Auto-run the model for the default symbol (trade plan, targets, reasons)
  try { await predictionStore.generateForSymbol(selectedSymbol.value); } catch { /* ignore */ }
}

// Re-run predictions whenever the selected symbol changes
watch(selectedSymbol, async (sym) => {
  if (!sym) return;
  try { await predictionStore.generateForSymbol(sym); } catch { /* ignore */ }
});

onMounted(() => {
  init();
  // Refresh market data every 60 seconds
  refreshInterval = setInterval(async () => {
    await Promise.allSettled([
      marketStore.fetchMarket(),
      marketStore.fetchWatchlist()
    ]);
  }, 60_000);
  // Pull fresh scan + alerts every 5 minutes (backend rescans itself on cron)
  scannerInterval = setInterval(() => {
    scannerStore.refresh();
    predictionStore.fetchAccuracy();
  }, 5 * 60_000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
  clearInterval(scannerInterval);
  marketStore.disconnectLive();
});
</script>

<style scoped>
/* Responsive dashboard grid: side panels shrink via minmax (no clipping),
   the chart takes the remaining width, and the bottom row gets real height
   for the opportunities list + trade plan. */
.dash-grid {
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(0, 1fr) minmax(220px, 280px);
  grid-template-rows: minmax(0, 1fr) minmax(240px, 300px);
  gap: 6px;
  padding: 6px;
}
.news-area  { grid-column: 1; grid-row: 1 / span 2; }
.chart-area { grid-column: 2; grid-row: 1; }
.watch-area { grid-column: 3; grid-row: 1 / span 2; }
.bottom-area {
  grid-column: 2;
  grid-row: 2;
  grid-template-columns: minmax(0, 1fr) minmax(250px, 330px);
  gap: 6px;
}

/* Tighter side columns on mid widths */
@media (max-width: 1280px) {
  .dash-grid { grid-template-columns: minmax(180px, 215px) minmax(0, 1fr) minmax(195px, 240px); }
}

/* Stack vertically and let the dashboard scroll on narrow windows */
@media (max-width: 1024px) {
  .dash-grid {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    grid-auto-rows: minmax(280px, auto);
    overflow-y: auto;
  }
  .news-area, .chart-area, .watch-area, .bottom-area {
    grid-column: 1;
    grid-row: auto;
  }
  .chart-area { min-height: 360px; }
  .watch-area { min-height: 480px; }
  .bottom-area { grid-template-columns: 1fr; grid-auto-rows: minmax(260px, auto); }
}
</style>
