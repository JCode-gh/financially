<template>
  <div class="flex flex-col h-full overflow-y-auto lg:overflow-hidden bg-surface">
    <div class="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 border-b border-surface-300 flex-shrink-0">
      <button
        type="button"
        @click="goBack"
        :aria-label="$t('common.back')"
        class="text-gray-400 hover:text-white transition-colors p-1 focus-visible:ring-2 ring-accent/50 rounded"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <div class="flex-1 min-w-0">
        <span class="font-mono text-base sm:text-lg font-bold text-white">{{ symbol }}</span>
        <span v-if="quote?.name" class="text-sm text-gray-500 ml-2 hidden sm:inline">{{ quote.name }}</span>
        <span v-if="quote?.price != null" class="ml-2 sm:ml-3 font-mono text-sm text-gray-300">{{ formatPrice(quote.price, quote.currency) }}</span>
        <span v-if="quote?.changePct != null" class="ml-1.5 font-mono text-sm" :class="quote.changePct >= 0 ? 'text-bull' : 'text-bear'">
          {{ formatPct(quote.changePct) }}
        </span>
      </div>
      <button
        v-if="!onList"
        type="button"
        @click="addToList"
        class="text-xs font-mono px-2.5 py-1.5 rounded border border-surface-300 text-gray-400 hover:text-accent hover:border-accent/40"
      >
        {{ $t('common.addToList') }}
      </button>
      <button
        v-if="ui.isPro"
        @click="showTradeSetup = true"
        class="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-accent/50 text-accent text-xs font-mono hover:bg-accent/10 transition-colors flex-shrink-0"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        {{ $t('setup.tradeSetup') }}
      </button>
    </div>

    <StockVerdict :symbol="symbol" :loading="generating" />

    <div class="min-h-[280px] h-[46vh] lg:h-auto lg:flex-1 lg:min-h-0 overflow-hidden w-full">
      <StockChart :symbol="symbol" hide-quote flush />
    </div>

    <div v-if="digest || sources.length" class="flex-shrink-0 px-4 sm:px-5 py-3 border-t border-surface-300 max-h-[40vh] overflow-y-auto overscroll-contain w-full">
      <SourceList :items="sources" :digest="digest" :heading="$t('verdict.sources')" />
    </div>

    <TradeSetupModal
      :visible="showTradeSetup"
      :symbol="symbol"
      @close="showTradeSetup = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMarketStore } from '../stores/marketStore.js';
import { usePredictionStore } from '../stores/predictionStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { formatPrice, formatPct } from '../utils/format.js';
import StockChart from '../components/stocks/StockChart.vue';
import StockVerdict from '../components/predictions/StockVerdict.vue';
import TradeSetupModal from '../components/predictions/TradeSetupModal.vue';
import SourceList from '../components/news/SourceList.vue';

const route = useRoute();
const router = useRouter();
const marketStore = useMarketStore();
const predictionStore = usePredictionStore();
const ui = useUiStore();

const symbol = computed(() => (route.params.symbol || '').toUpperCase());
const quote = computed(() =>
  marketStore.selectedQuote?.symbol === symbol.value ? marketStore.selectedQuote : null
);
const generating = computed(() => predictionStore.generating);
const onList = computed(() => marketStore.isOnWatchlist(symbol.value));
const showTradeSetup = ref(false);

function desk() {
  const key = symbol.value;
  return predictionStore.currentPrediction?.ticker === key
    ? predictionStore.currentPrediction
    : predictionStore.byTicker?.[key];
}

const sources = computed(() => (desk()?.sources || []).filter(s => s?.title && s?.url));
const digest = computed(() => String(desk()?.sourcesDigest || '').trim());

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push({ name: 'dashboard' });
}

async function addToList() {
  await marketStore.addToWatchlist(symbol.value);
}

async function loadStock(sym) {
  if (!sym) return;
  await marketStore.selectSymbol(sym);
  await new Promise(r => setTimeout(r, 200));
  try {
    await predictionStore.generateForSymbol(sym, marketStore.selectedQuote?.name);
  } catch { /* shown in verdict */ }
}

watch(symbol, loadStock, { immediate: true });
</script>
