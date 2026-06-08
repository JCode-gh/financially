import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { newsApi } from '../services/api.js';

export const useNewsStore = defineStore('news', () => {
  const articles = ref([]);
  const stockArticles = ref([]);
  const marketSentiment = ref({ score: 0, label: 'neutral' });
  const stockSentiment = ref({ score: 0, label: 'neutral' });
  const loading = ref({ market: false, stock: false });
  const activeFilter = ref('all'); // 'all' | 'bullish' | 'bearish' | 'neutral'

  const filteredArticles = computed(() => {
    if (activeFilter.value === 'all') return articles.value;
    return articles.value.filter(a => a.sentiment?.label === activeFilter.value);
  });

  const sentimentCounts = computed(() => {
    const counts = { bullish: 0, bearish: 0, neutral: 0 };
    articles.value.forEach(a => {
      if (a.sentiment?.label) counts[a.sentiment.label]++;
    });
    return counts;
  });

  async function fetchMarketNews() {
    loading.value.market = true;
    try {
      const res = await newsApi.market();
      articles.value = res.data.data || [];
      marketSentiment.value = res.data.marketSentiment || { score: 0, label: 'neutral' };
    } catch { /* silently fail, show cached if any */ }
    finally { loading.value.market = false; }
  }

  async function fetchStockNews(symbol, name) {
    loading.value.stock = true;
    stockArticles.value = [];
    try {
      const res = await newsApi.stock(symbol, name);
      stockArticles.value = res.data.data || [];
      stockSentiment.value = res.data.stockSentiment || { score: 0, label: 'neutral' };
    } catch { stockArticles.value = []; }
    finally { loading.value.stock = false; }
  }

  function setFilter(filter) { activeFilter.value = filter; }

  return {
    articles, stockArticles, marketSentiment, stockSentiment,
    loading, activeFilter, filteredArticles, sentimentCounts,
    fetchMarketNews, fetchStockNews, setFilter
  };
});
