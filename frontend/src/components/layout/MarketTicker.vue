<template>
  <div class="hidden sm:flex bg-surface-100 border-b border-surface-300 h-8 items-center overflow-hidden">
    <div class="flex-shrink-0 px-3 text-xs font-mono font-semibold border-r border-surface-300 h-full flex items-center"
         :class="store.liveConnected ? 'text-accent' : 'text-gray-500'">
      {{ store.liveConnected ? $t('status.live') : $t('status.idle') }}
      <span class="ml-1.5" :class="store.liveConnected ? 'live-dot' : 'idle-dot'"></span>
    </div>
    <div class="ticker-wrap flex-1 relative">
      <div class="ticker-content">
        <RouterLink
          v-for="item in doubled"
          :key="item._key"
          :to="{ name: 'stock', params: { symbol: item.symbol } }"
          class="group inline-flex items-center gap-2 px-4 text-xs font-mono border-r border-surface-300/50 h-8 hover:bg-white/5 cursor-pointer no-underline hover:no-underline"
          :title="item.symbol"
          @click="open(item.symbol)"
        >
          <span class="text-gray-400 group-hover:text-gray-200">{{ item.name }}</span>
          <span class="font-semibold" :class="item.changePct >= 0 ? 'text-bull' : 'text-bear'">
            {{ formatNumber(item.price, 2) }}
          </span>
          <span :class="item.changePct >= 0 ? 'text-bull' : 'text-bear'">
            {{ item.changePct >= 0 ? '▲' : '▼' }}
            {{ formatNumber(Math.abs(item.changePct || 0), 2) }}%
          </span>
        </RouterLink>
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
import { formatNumber } from '../../utils/format.js';
import { intlLocale, readLocale } from '../../i18n/locale.js';

const store = useMarketStore();

function open(symbol) {
  if (symbol) store.selectSymbol(symbol);
}
const timeStr = ref('');
let timer;

const doubled = computed(() => {
  const items = store.marketData;
  return [...items, ...items].map((item, i) => ({ ...item, _key: `${item.symbol}_${i}` }));
});

function updateTime() {
  const now = new Date();
  timeStr.value = now.toLocaleTimeString(intlLocale(readLocale()), { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

onMounted(() => {
  updateTime();
  timer = setInterval(updateTime, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>
