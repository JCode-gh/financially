<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0">
      <span class="label">Watchlist</span>
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono text-gray-500">{{ watchlistData.length }} stocks</span>
        <button
          @click="showAddInput = !showAddInput"
          class="text-gray-400 hover:text-accent transition-colors text-xs"
          title="Add stock"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- Add stock input -->
    <div v-if="showAddInput" class="px-3 py-2 border-b border-surface-300/50 flex-shrink-0">
      <div class="flex gap-2">
        <input
          v-model="newSymbol"
          @keydown.enter="addSymbol"
          @keydown.escape="showAddInput = false"
          placeholder="SYMBOL"
          class="flex-1 bg-surface-200 border border-surface-300 rounded px-2 py-1 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 uppercase"
          autofocus
        />
        <button @click="addSymbol" class="text-accent text-xs font-mono hover:text-accent/70">ADD</button>
      </div>
    </div>

    <!-- Top movers summary -->
    <div v-if="topMovers.gainers.length" class="px-3 py-1.5 border-b border-surface-300/50 flex-shrink-0 flex gap-3 text-xs font-mono">
      <div class="flex items-center gap-1 text-bull">
        <span>▲</span>
        <span v-for="g in topMovers.gainers.slice(0, 2)" :key="g.symbol" class="opacity-80">
          {{ g.symbol }} +{{ (g.changePct || 0).toFixed(1) }}%
        </span>
      </div>
      <div class="flex items-center gap-1 text-bear ml-auto">
        <span v-for="l in topMovers.losers.slice(0, 2)" :key="l.symbol" class="opacity-80">
          {{ l.symbol }} {{ (l.changePct || 0).toFixed(1) }}%
        </span>
        <span>▼</span>
      </div>
    </div>

    <!-- Stock list -->
    <div class="panel-scroll flex-1">
      <div v-if="loading" class="flex items-center justify-center h-20">
        <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>
      <template v-else>
        <button
          v-for="stock in watchlistData"
          :key="stock.symbol"
          @click="select(stock.symbol)"
          class="w-full flex items-center gap-2 px-3 py-2 border-b border-surface-300/30 hover:bg-surface-200/50 transition-colors group"
          :class="selectedSymbol === stock.symbol ? 'bg-surface-200/60 border-l-2 border-l-accent' : ''"
        >
          <div class="flex-1 min-w-0 text-left">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-semibold" :class="selectedSymbol === stock.symbol ? 'text-accent' : 'text-gray-200'">
                {{ stock.symbol }}
              </span>
              <span
                v-if="earningsBadge(stock.symbol)"
                class="text-[9px] font-mono px-1 py-px rounded leading-tight flex-shrink-0"
                :class="earningsBadge(stock.symbol).cls"
                :title="'Earnings ' + earningsBadge(stock.symbol).date"
              >{{ earningsBadge(stock.symbol).text }}</span>
              <span class="text-gray-500 text-xs truncate hidden xl:block">{{ stock.name?.split(' ')[0] }}</span>
            </div>
            <!-- Mini sparkline-style bar -->
            <div class="w-full h-0.5 bg-surface-300 rounded mt-1 overflow-hidden">
              <div
                class="h-full rounded transition-all duration-300"
                :class="(stock.changePct || 0) >= 0 ? 'bg-bull/50' : 'bg-bear/50'"
                :style="{ width: Math.min(100, Math.abs(stock.changePct || 0) * 5) + '%' }"
              ></div>
            </div>
          </div>

          <div class="text-right flex-shrink-0">
            <div class="font-mono text-xs font-semibold" :class="(stock.changePct || 0) >= 0 ? 'text-gray-200' : 'text-gray-200'">
              ${{ (stock.price || 0).toFixed(2) }}
            </div>
            <div class="font-mono text-xs" :class="(stock.changePct || 0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ (stock.changePct || 0) >= 0 ? '+' : '' }}{{ (stock.changePct || 0).toFixed(2) }}%
            </div>
          </div>

          <!-- Remove button -->
          <button
            @click.stop="remove(stock.symbol)"
            class="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-bear transition-all ml-1 flex-shrink-0"
          >
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useMarketStore } from '../../stores/marketStore.js';
import { useScannerStore } from '../../stores/scannerStore.js';

const store = useMarketStore();
const scanner = useScannerStore();
const showAddInput = ref(false);
const newSymbol = ref('');

const watchlistData = computed(() => store.watchlistData);
const selectedSymbol = computed(() => store.selectedSymbol);
const loading = computed(() => store.loading.watchlist);
const topMovers = computed(() => store.topMovers);

// "E-3" chip when earnings are within a week (amber when imminent)
function earningsBadge(symbol) {
  const e = scanner.earnings[symbol];
  if (!e || e.daysUntil == null || e.daysUntil < 0 || e.daysUntil > 7) return null;
  return {
    text: e.daysUntil === 0 ? 'E today' : `E-${e.daysUntil}`,
    date: e.date,
    cls: e.daysUntil <= 2 ? 'bg-neutral/20 text-neutral' : 'bg-surface-300 text-gray-400'
  };
}

async function select(symbol) {
  await store.selectSymbol(symbol);
}

function addSymbol() {
  const sym = newSymbol.value.trim().toUpperCase();
  if (sym) {
    store.addToWatchlist(sym);
    newSymbol.value = '';
    showAddInput.value = false;
  }
}

function remove(symbol) {
  store.removeFromWatchlist(symbol);
}
</script>
