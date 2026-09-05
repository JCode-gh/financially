<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <div class="flex items-center gap-2 px-3 py-2.5 border-b border-surface-300 flex-shrink-0 flex-wrap">
      <span class="label">{{ $t('news.title') }}</span>
      <span class="text-[11px] font-mono px-1.5 py-0.5 rounded" :class="sentimentBadge">
        {{ sentimentLabel }}
      </span>
      <div class="flex-1"></div>
      <template v-if="ui.isPro">
        <button
          v-for="f in filters"
          :key="f.value"
          @click="setFilter(f.value)"
          class="text-[11px] px-1.5 py-0.5 rounded font-mono transition-colors"
          :class="activeFilter === f.value ? f.activeClass : 'text-gray-600 hover:text-gray-300'"
        >
          {{ f.label }}
        </button>
      </template>
    </div>

    <div class="flex border-b border-surface-300/60 flex-shrink-0">
      <button
        @click="mode = 'watch'"
        class="flex-1 py-2 text-xs font-mono transition-colors"
        :class="mode === 'watch' ? 'text-accent border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'"
      >
        {{ $t('news.watchlist') }}
      </button>
      <button
        v-if="hasStockTab"
        @click="mode = 'stock'"
        class="flex-1 py-2 text-xs font-mono transition-colors"
        :class="mode === 'stock' ? 'text-accent border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'"
      >
        {{ selectedSymbol }}
      </button>
    </div>

    <div class="panel-scroll flex-1">
      <div v-if="loading" class="flex items-center justify-center h-20">
        <div class="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>
      <div v-else-if="newsStore.error && !displayArticles.length" class="flex items-center justify-center h-20 text-neutral text-xs font-mono px-3 text-center">
        {{ newsStore.error }}
      </div>
      <div v-else-if="displayArticles.length === 0" class="flex items-center justify-center h-20 text-gray-500 text-xs px-3 text-center">
        <span v-if="mode === 'stock'">{{ $t('news.emptyStock', { symbol: selectedSymbol }) }}</span>
        <span v-else>{{ $t('news.emptyWatch') }}</span>
      </div>
      <template v-else>
        <NewsCard v-for="article in displayArticles" :key="article.id" :article="article" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNewsStore } from '../../stores/newsStore.js';
import { useMarketStore } from '../../stores/marketStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import NewsCard from './NewsCard.vue';

const newsStore = useNewsStore();
const marketStore = useMarketStore();
const ui = useUiStore();
const { t } = useI18n();

const props = defineProps({
  preferWatch: { type: Boolean, default: false }
});

const mode = ref('watch');
const activeFilter = computed(() => newsStore.activeFilter);
const selectedSymbol = computed(() => marketStore.selectedSymbol);
const hasStockTab = computed(() => isValidTicker(selectedSymbol.value));

function isValidTicker(symbol) {
  if (!symbol || typeof symbol !== 'string') return false;
  const t = symbol.trim().toUpperCase();
  if (!t || ['NULL', 'UNDEFINED', 'NONE'].includes(t)) return false;
  return /^[A-Z0-9]{1,10}(\.[A-Z]{1,4})?$/.test(t);
}

const loading = computed(() =>
  mode.value === 'stock' ? newsStore.loading.stock : newsStore.loading.market
);

const displayArticles = computed(() => {
  const articles = mode.value === 'stock' ? newsStore.stockArticles : newsStore.filteredArticles;
  if (activeFilter.value === 'all' || mode.value !== 'stock') return articles;
  return articles.filter(a => a.sentiment?.label === activeFilter.value);
});

const activeSentiment = computed(() =>
  mode.value === 'stock' ? newsStore.stockSentiment : newsStore.marketSentiment
);

const sentimentBadge = computed(() => {
  const l = activeSentiment.value.label;
  if (l === 'bullish') return 'bg-bull/10 text-bull';
  if (l === 'bearish') return 'bg-bear/10 text-bear';
  return 'bg-gray-500/10 text-gray-400';
});

const sentimentLabel = computed(() => {
  const l = activeSentiment.value.label;
  if (l === 'bullish') return t('news.sentiment.bullish');
  if (l === 'bearish') return t('news.sentiment.bearish');
  return t('news.sentiment.neutral');
});

const filters = computed(() => [
  { value: 'all', label: t('news.all'), activeClass: 'text-accent' },
  { value: 'bullish', label: '▲', activeClass: 'text-bull' },
  { value: 'bearish', label: '▼', activeClass: 'text-bear' }
]);

function setFilter(f) { newsStore.setFilter(f); }

function watchlistTickers() {
  const quotes = marketStore.watchlistData || [];
  return quotes.map(q => ({ symbol: q.symbol, name: q.name }));
}

async function loadWatchlistNews() {
  const tickers = watchlistTickers();
  const extra = selectedSymbol.value ? [{ symbol: selectedSymbol.value, name: marketStore.selectedQuote?.name }] : [];
  const all = [...tickers, ...extra];
  await newsStore.fetchMarketNews(
    all.map(t => t.symbol).filter(Boolean),
    all.map(t => t.name || '')
  );
}

watch(selectedSymbol, async (sym) => {
  if (!isValidTicker(sym)) {
    mode.value = 'watch';
    return;
  }
  if (!props.preferWatch) mode.value = 'stock';
  await newsStore.fetchStockNews(sym, marketStore.selectedQuote?.name);
}, { immediate: true });

watch(mode, async (m) => {
  if (m === 'stock' && isValidTicker(selectedSymbol.value)) {
    await newsStore.fetchStockNews(selectedSymbol.value, marketStore.selectedQuote?.name);
  }
});

watch(() => marketStore.watchlistSymbols.join(','), () => {
  loadWatchlistNews();
});

onMounted(() => {
  loadWatchlistNews();
});
</script>
