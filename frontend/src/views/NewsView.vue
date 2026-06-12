<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <NewsFeed />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import NewsFeed from '../components/news/NewsFeed.vue';
import { useNewsStore } from '../stores/newsStore.js';

const newsStore = useNewsStore();

onMounted(() => {
  newsStore.fetchMarketNews();
});
</script>
