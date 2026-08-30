<template>
  <div class="h-dvh flex flex-col overflow-hidden">
    <AppHeader />
    <MarketTicker />
    <main class="flex-1 min-h-0 overflow-hidden">
      <RouterView />
    </main>
    <StatusBar />
    <MobileNav />
    <CommandPalette />
    <ToastHost />
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppHeader from './components/layout/AppHeader.vue';
import MarketTicker from './components/layout/MarketTicker.vue';
import StatusBar from './components/layout/StatusBar.vue';
import MobileNav from './components/layout/MobileNav.vue';
import CommandPalette from './components/layout/CommandPalette.vue';
import ToastHost from './components/layout/ToastHost.vue';
import { useMarketStore } from './stores/marketStore.js';
import { usePredictionStore } from './stores/predictionStore.js';
import { useUiStore } from './stores/uiStore.js';

const market = useMarketStore();
const predictions = usePredictionStore();
const ui = useUiStore();
const { locale } = useI18n();

watch(locale, async () => {
  predictions.byTicker = {};
  predictions.currentPrediction = null;
  const sym = market.selectedSymbol;
  if (sym) {
    try {
      await predictions.generateForSymbol(sym, market.selectedQuote?.name, { force: true });
    } catch { /* shown in verdict */ }
  }
});
let refreshTimer;
let healthTimer;

function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    ui.commandOpen = !ui.commandOpen;
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  const alive = await ui.checkHealth();
  if (alive) {
    await Promise.allSettled([
      market.init(),
      predictions.fetchAccuracy()
    ]);
  }
  market.connectLive();
  refreshTimer = setInterval(() => {
    Promise.allSettled([market.fetchMarket(), market.fetchWatchlist()]);
  }, 60_000);
  healthTimer = setInterval(() => ui.checkHealth(), 30_000);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  clearInterval(refreshTimer);
  clearInterval(healthTimer);
});
</script>
