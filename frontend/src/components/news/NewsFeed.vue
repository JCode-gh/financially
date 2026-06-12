<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0">
      <div class="flex items-center gap-2">
        <span class="label">News Feed</span>
        <span class="text-xs font-mono px-1.5 py-0.5 rounded" :class="sentimentBadge">
          {{ marketSentiment.label }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-for="f in filters"
          :key="f.value"
          @click="setFilter(f.value)"
          class="text-xs px-2 py-0.5 rounded font-mono transition-colors"
          :class="activeFilter === f.value ? f.activeClass : 'text-gray-500 hover:text-gray-300'"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <!-- Sentiment bar -->
    <div class="flex items-center gap-1 px-3 py-1.5 border-b border-surface-300/50 flex-shrink-0 text-xs font-mono">
      <span class="text-bull">{{ sentimentCounts.bullish }}▲</span>
      <div class="flex-1 h-1 bg-surface-300 rounded-full overflow-hidden flex">
        <div class="h-full bg-bull/70 transition-all" :style="{ width: bullPct + '%' }"></div>
        <div class="h-full bg-surface-300"></div>
        <div class="h-full bg-bear/70 transition-all" :style="{ width: bearPct + '%' }"></div>
      </div>
      <span class="text-bear">▼{{ sentimentCounts.bearish }}</span>
    </div>

    <!-- Per-stock tab only when a stock is selected -->
    <div v-if="hasStockTab" class="flex border-b border-surface-300/50 flex-shrink-0">
      <button
        @click="mode = 'market'"
        class="flex-1 py-1.5 text-xs font-mono transition-colors"
        :class="mode === 'market' ? 'text-accent border-b border-accent' : 'text-gray-500 hover:text-gray-300'"
      >
        Market
      </button>
      <button
        @click="mode = 'stock'"
        class="flex-1 py-1.5 text-xs font-mono transition-colors"
        :class="mode === 'stock' ? 'text-accent border-b border-accent' : 'text-gray-500 hover:text-gray-300'"
      >
        {{ selectedSymbol }}
      </button>
    </div>

    <!-- Articles -->
    <div class="panel-scroll flex-1">
      <div v-if="loading" class="flex items-center justify-center h-20">
        <div class="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>
      <div v-else-if="displayArticles.length === 0" class="flex flex-col items-center justify-center h-20 text-gray-500 text-xs">
        <span>No articles found</span>
        <span class="text-gray-600 mt-1">Add API keys for more news</span>
      </div>
      <template v-else>
        <NewsCard v-for="article in displayArticles" :key="article.id" :article="article" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useNewsStore } from '../../stores/newsStore.js';
import { useMarketStore } from '../../stores/marketStore.js';
import NewsCard from './NewsCard.vue';

const newsStore = useNewsStore();
const marketStore = useMarketStore();

const mode = ref('market');
const activeFilter = computed(() => newsStore.activeFilter);
const marketSentiment = computed(() => newsStore.marketSentiment);
const sentimentCounts = computed(() => newsStore.sentimentCounts);
const selectedSymbol = computed(() => marketStore.selectedSymbol);
const hasStockTab = computed(() => isValidTicker(selectedSymbol.value));

function isValidTicker(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  const t = symbol.trim().toUpperCase();
  if (!t || ['NULL', 'UNDEFINED', 'NONE'].includes(t)) return false;
  return /^[A-Z0-9]{1,10}(\.[A-Z]{1,4})?$/.test(t);
}

const loading = computed(() =>
  mode.value === 'market' ? newsStore.loading.market : newsStore.loading.stock
);

const displayArticles = computed(() => {
  const articles = mode.value === 'market' ? newsStore.filteredArticles : newsStore.stockArticles;
  return articles;
});

const bullPct = computed(() => {
  const total = sentimentCounts.value.bullish + sentimentCounts.value.bearish + sentimentCounts.value.neutral;
  return total > 0 ? (sentimentCounts.value.bullish / total * 100) : 33;
});
const bearPct = computed(() => {
  const total = sentimentCounts.value.bullish + sentimentCounts.value.bearish + sentimentCounts.value.neutral;
  return total > 0 ? (sentimentCounts.value.bearish / total * 100) : 33;
});

const sentimentBadge = computed(() => {
  const l = marketSentiment.value.label;
  if (l === 'bullish') return 'bg-bull/10 text-bull';
  if (l === 'bearish') return 'bg-bear/10 text-bear';
  return 'bg-gray-500/10 text-gray-400';
});

const filters = [
  { value: 'all', label: 'ALL', activeClass: 'text-accent' },
  { value: 'bullish', label: '▲', activeClass: 'text-bull' },
  { value: 'bearish', label: '▼', activeClass: 'text-bear' }
];

function setFilter(f) { newsStore.setFilter(f); }

watch(selectedSymbol, async (sym) => {
  if (!isValidTicker(sym)) {
    mode.value = 'market';
    return;
  }
  if (mode.value === 'stock') {
    await newsStore.fetchStockNews(sym);
  }
});

watch(mode, async (m) => {
  if (m === 'stock' && isValidTicker(selectedSymbol.value)) {
    await newsStore.fetchStockNews(selectedSymbol.value);
  } else if (m === 'stock') {
    mode.value = 'market';
  }
});
</script>
