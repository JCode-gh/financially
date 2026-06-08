<template>
  <div class="bg-surface-100 border-b border-surface-300 h-8 flex items-center overflow-hidden">
    <div class="flex-shrink-0 px-3 text-xs font-mono text-accent font-semibold border-r border-surface-300 h-full flex items-center">
      LIVE
      <span class="live-dot ml-1.5"></span>
    </div>
    <div class="ticker-wrap flex-1 relative">
      <div class="ticker-content">
        <template v-for="item in doubled" :key="item._key">
          <span class="inline-flex items-center gap-2 px-4 text-xs font-mono border-r border-surface-300/50 h-8">
            <span class="text-gray-400">{{ item.name }}</span>
            <span class="font-semibold" :class="item.changePct >= 0 ? 'text-bull' : 'text-bear'">
              {{ formatPrice(item.price, item.type) }}
            </span>
            <span :class="item.changePct >= 0 ? 'text-bull' : 'text-bear'">
              {{ item.changePct >= 0 ? '▲' : '▼' }}
              {{ Math.abs(item.changePct || 0).toFixed(2) }}%
            </span>
          </span>
        </template>
      </div>
    </div>
    <div class="flex-shrink-0 px-3 text-xs text-gray-500 border-l border-surface-300 h-full flex items-center font-mono">
      {{ timeStr }}
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useMarketStore } from '../../stores/marketStore.js';

const store = useMarketStore();
const timeStr = ref('');
let timer;

const doubled = computed(() => {
  const items = store.marketData;
  return [...items, ...items].map((item, i) => ({ ...item, _key: `${item.symbol}_${i}` }));
});

function formatPrice(price, type) {
  if (!price) return '—';
  if (type === 'forex') return price.toFixed(4);
  if (price > 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return price.toFixed(2);
}

function updateTime() {
  const now = new Date();
  timeStr.value = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

onMounted(() => {
  updateTime();
  timer = setInterval(updateTime, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>
