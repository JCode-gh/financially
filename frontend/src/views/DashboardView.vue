<template>
  <div class="h-full min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden panel-scroll bg-surface">
    <div class="flex-shrink-0 px-2.5 pt-2.5">
      <StockVerdict :symbol="selectedSymbol" :loading="predictionStore.generating" variant="strip" />
    </div>

    <div class="dash-grid flex-1 min-h-0" :class="ui.isSimple ? 'is-simple' : 'is-pro'">
      <div class="news-area min-h-0 overflow-hidden">
        <NewsFeed />
      </div>

      <div class="chart-area min-h-0 overflow-hidden">
        <StockChart :symbol="selectedSymbol" />
      </div>

      <div class="watch-area min-h-0 overflow-hidden">
        <WatchList />
      </div>

      <div v-if="ui.isPro" class="bottom-area grid min-h-0 overflow-hidden">
        <OpportunitiesPanel />
        <PredictionPanel />
      </div>
    </div>

    <div v-if="ui.backendDown" class="fixed bottom-20 lg:bottom-12 right-3 lg:right-4 bg-surface-100 border border-bear/40 text-bear text-xs font-mono px-4 py-3 rounded shadow-xl max-w-[min(20rem,calc(100vw-1.5rem))] z-40">
      <div class="font-semibold mb-1">{{ $t('dashboard.backendDown') }}</div>
      <div class="text-gray-400">{{ $t('dashboard.backendHint', { cmd: 'cd backend && npm run dev' }) }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useMarketStore } from '../stores/marketStore.js';
import { useNewsStore } from '../stores/newsStore.js';
import { usePredictionStore } from '../stores/predictionStore.js';
import { useScannerStore } from '../stores/scannerStore.js';
import { useUiStore } from '../stores/uiStore.js';
import NewsFeed from '../components/news/NewsFeed.vue';
import StockChart from '../components/stocks/StockChart.vue';
import WatchList from '../components/stocks/WatchList.vue';
import OpportunitiesPanel from '../components/scanner/OpportunitiesPanel.vue';
import PredictionPanel from '../components/predictions/PredictionPanel.vue';
import StockVerdict from '../components/predictions/StockVerdict.vue';

const marketStore = useMarketStore();
const newsStore = useNewsStore();
const predictionStore = usePredictionStore();
const scannerStore = useScannerStore();
const ui = useUiStore();

const selectedSymbol = computed(() => marketStore.selectedSymbol);
let scannerInterval;

async function init() {
  if (ui.backendDown) return;

  await Promise.allSettled([
    predictionStore.fetchAccuracy()
  ]);
  scannerStore.init();

  const first = marketStore.watchlistSymbols[0] || 'SPY';
  if (!marketStore.selectedSymbol) {
    await marketStore.selectSymbol(first);
  } else if (marketStore.selectedSymbol) {
    try { await predictionStore.generateForSymbol(marketStore.selectedSymbol, marketStore.selectedQuote?.name); } catch { /* ignore */ }
  }
}

watch(selectedSymbol, async (sym) => {
  if (!sym) return;
  const name = marketStore.selectedQuote?.name;
  newsStore.fetchStockNews(sym, name);
  try { await predictionStore.generateForSymbol(sym, name); } catch { /* ignore */ }
});

onMounted(() => {
  init();
  scannerInterval = setInterval(() => {
    scannerStore.refresh();
    predictionStore.fetchAccuracy();
  }, 5 * 60_000);
});

onUnmounted(() => {
  clearInterval(scannerInterval);
});
</script>

<style scoped>
.dash-grid {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(230px, 300px);
  grid-template-rows: minmax(0, 2fr) minmax(200px, 1fr);
  gap: 10px;
  padding: 10px;
}
.news-area  { grid-column: 1; grid-row: 1 / span 2; }
.chart-area { grid-column: 2; grid-row: 1; }
.watch-area { grid-column: 3; grid-row: 1 / span 2; }
.dash-grid.is-simple .chart-area { grid-row: 1 / span 2; }
.dash-grid.is-simple {
  grid-template-rows: minmax(0, 1fr);
}
.bottom-area {
  grid-column: 2;
  grid-row: 2;
  grid-template-columns: minmax(0, 1.1fr) minmax(240px, 320px);
  gap: 10px;
}

@media (max-width: 1280px) {
  .dash-grid { grid-template-columns: minmax(200px, 230px) minmax(0, 1fr) minmax(210px, 250px); }
}

@media (max-width: 1024px) {
  .dash-grid {
    display: flex;
    flex-direction: column;
    overflow: visible;
    min-height: unset;
    padding: 8px;
    gap: 8px;
  }
  .chart-area { order: 1; height: 300px; flex-shrink: 0; }
  .watch-area { order: 2; height: 220px; flex-shrink: 0; }
  .news-area { order: 3; height: 380px; flex-shrink: 0; }
  .bottom-area {
    order: 4;
    display: flex;
    flex-direction: column;
    min-height: 240px;
    height: auto;
    grid-template-columns: none;
  }
  .bottom-area > * { min-height: 240px; }
}

@media (max-width: 480px) {
  .chart-area { height: 260px; }
  .watch-area { height: 200px; }
  .news-area { height: 360px; }
}
</style>
