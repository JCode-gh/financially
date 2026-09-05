<template>
  <div class="h-full min-h-0 overflow-y-auto panel-scroll bg-surface">
    <div class="sticky top-0 z-10 bg-surface">
      <WatchlistTabs />
    </div>

    <div class="mx-auto w-full max-w-[1600px] px-3 sm:px-5 pb-20 lg:pb-12 space-y-8">
      <header class="pt-5 flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="label">{{ $t('nav.terminal') }}</p>
          <h1 class="mt-1 text-xl sm:text-2xl text-white tracking-tight">
            {{ listName }}
          </h1>
          <p class="mt-1 text-xs font-mono text-gray-500">
            {{ $t('dashboard.bookHint', { n: marketStore.watchlistSymbols.length, name: listName }) }}
          </p>
        </div>
      </header>

      <PortfolioAsk />

      <PortfolioBook />

      <section v-if="selectedSymbol" class="space-y-3">
        <div>
          <h2 class="text-sm font-medium text-white">{{ $t('dashboard.focus') }}</h2>
          <p class="mt-0.5 text-[11px] font-mono text-gray-500">{{ $t('dashboard.selectToChart') }}</p>
        </div>
        <StockVerdict :symbol="selectedSymbol" :loading="predictionStore.generating" variant="strip" />
        <div class="h-[28rem] sm:h-[32rem] lg:h-[38rem]">
          <StockChart :symbol="selectedSymbol" />
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-sm font-medium text-white">{{ $t('dashboard.tape') }}</h2>
        <div class="h-[32rem] lg:h-[36rem]">
          <NewsFeed prefer-watch />
        </div>
      </section>

      <section v-if="ui.isPro" class="space-y-3">
        <h2 class="text-sm font-medium text-white">{{ $t('dashboard.model') }}</h2>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="h-[28rem]">
            <OpportunitiesPanel />
          </div>
          <div class="h-[28rem]">
            <PredictionPanel />
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="ui.backendDown"
      class="fixed bottom-20 lg:bottom-12 right-3 lg:right-4 bg-surface-100 border border-bear/40 text-bear text-xs font-mono px-4 py-3 rounded shadow-xl max-w-[min(20rem,calc(100vw-1.5rem))] z-40"
    >
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
import WatchlistTabs from '../components/stocks/WatchlistTabs.vue';
import OpportunitiesPanel from '../components/scanner/OpportunitiesPanel.vue';
import PredictionPanel from '../components/predictions/PredictionPanel.vue';
import StockVerdict from '../components/predictions/StockVerdict.vue';
import PortfolioAsk from '../components/desk/PortfolioAsk.vue';
import PortfolioBook from '../components/desk/PortfolioBook.vue';

const marketStore = useMarketStore();
const newsStore = useNewsStore();
const predictionStore = usePredictionStore();
const scannerStore = useScannerStore();
const ui = useUiStore();

const selectedSymbol = computed(() => marketStore.selectedSymbol);
const listName = computed(() => marketStore.activeWatchlist?.name || '');
let scannerInterval;

async function ensureSelection() {
  const list = marketStore.watchlistSymbols;
  if (!list.length) return;
  if (!marketStore.selectedSymbol || !list.includes(marketStore.selectedSymbol)) {
    await marketStore.selectSymbol(list[0]);
  }
}

async function init() {
  if (ui.backendDown) return;

  await Promise.allSettled([
    predictionStore.fetchAccuracy()
  ]);
  scannerStore.init();
  await ensureSelection();
  if (marketStore.selectedSymbol) {
    try {
      await predictionStore.generateForSymbol(marketStore.selectedSymbol, marketStore.selectedQuote?.name);
    } catch { /* ignore */ }
  }
}

watch(selectedSymbol, async (sym) => {
  if (!sym) return;
  const name = marketStore.selectedQuote?.name;
  newsStore.fetchStockNews(sym, name);
  try { await predictionStore.generateForSymbol(sym, name); } catch { /* ignore */ }
});

watch(() => marketStore.watchlistSymbols.join(','), () => {
  ensureSelection();
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
