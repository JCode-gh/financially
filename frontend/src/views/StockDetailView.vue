<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <!-- Back + symbol header -->
    <div class="flex items-center gap-3 px-4 py-2 border-b border-surface-300 flex-shrink-0">
      <button @click="router.push({ name: 'stocks' })" class="text-gray-400 hover:text-white transition-colors p-1">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <div class="flex-1 min-w-0">
        <span class="font-mono text-lg font-bold text-white">{{ symbol }}</span>
        <span v-if="quote?.name" class="text-sm text-gray-500 ml-2">{{ quote.name }}</span>
      </div>
      <button
        @click="showTradeSetup = true"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/50 text-accent text-xs font-mono hover:bg-accent/10 transition-colors flex-shrink-0"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        Trade Setup
      </button>
    </div>

    <!-- Plain-language buy / sell / hold -->
    <StockVerdict :symbol="symbol" :loading="generating" />

    <!-- Chart with price targets drawn on it -->
    <div class="flex-1 min-h-0 overflow-hidden p-2 pt-0">
      <StockChart :symbol="symbol" show-predictions />
    </div>

    <!-- Trade setup modal -->
    <TradeSetupModal
      :visible="showTradeSetup"
      :symbol="symbol"
      @close="showTradeSetup = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMarketStore } from '../stores/marketStore.js';
import { usePredictionStore } from '../stores/predictionStore.js';
import StockChart from '../components/stocks/StockChart.vue';
import StockVerdict from '../components/predictions/StockVerdict.vue';
import TradeSetupModal from '../components/predictions/TradeSetupModal.vue';

const route = useRoute();
const router = useRouter();
const marketStore = useMarketStore();
const predictionStore = usePredictionStore();

const symbol = computed(() => (route.params.symbol || '').toUpperCase());
const quote = computed(() => marketStore.selectedQuote);
const generating = computed(() => predictionStore.generating);
const showTradeSetup = ref(false);

async function loadStock(sym) {
  if (!sym) return;
  await marketStore.selectSymbol(sym);
  // Let the chart fetch history first — avoids hammering Yahoo with parallel requests
  await new Promise(r => setTimeout(r, 300));
  try {
    await predictionStore.generateForSymbol(sym);
  } catch { /* ignore */ }
}

watch(symbol, loadStock, { immediate: true });

onMounted(() => {
  marketStore.connectLive();
});

onUnmounted(() => {
  marketStore.disconnectLive();
});
</script>
