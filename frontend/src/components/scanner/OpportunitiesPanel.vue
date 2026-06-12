<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <!-- Header with tabs -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0">
      <div class="flex items-center gap-3">
        <button
          class="label transition-colors"
          :class="tab === 'opportunities' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'"
          @click="tab = 'opportunities'"
        >⚡ Opportunities</button>
        <button
          class="label transition-colors"
          :class="tab === 'model' ? 'text-accent' : 'text-gray-500 hover:text-gray-300'"
          @click="tab = 'model'"
        >Model</button>
      </div>
      <div class="flex items-center gap-2 text-xs font-mono">
        <span v-if="lastScanAgo" class="text-gray-600">scan {{ lastScanAgo }}</span>
        <button
          @click="rescan"
          :disabled="running"
          class="px-2 py-0.5 rounded border transition-colors flex items-center gap-1"
          :class="running ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
        >
          <span v-if="running" class="animate-spin inline-block w-2.5 h-2.5 border border-accent border-t-transparent rounded-full"></span>
          {{ running ? 'Scanning' : 'Rescan' }}
        </button>
      </div>
    </div>

    <!-- Opportunities tab -->
    <div v-if="tab === 'opportunities'" class="panel-scroll flex-1 min-h-0">
      <div v-if="!opportunities.length" class="flex flex-col items-center justify-center h-24 text-gray-500 text-xs gap-1.5">
        <span v-if="loading || running">Scanning model universe…</span>
        <template v-else>
          <span>No scan yet</span>
          <span class="text-gray-600">Hit Rescan to rank your watchlist</span>
        </template>
      </div>

      <button
        v-for="(o, idx) in opportunities"
        :key="o.ticker"
        @click="select(o.ticker)"
        class="w-full text-left px-3 py-2 border-b border-surface-300/40 hover:bg-surface-200/50 transition-colors group"
        :class="selectedSymbol === o.ticker ? 'bg-surface-200/60 border-l-2 border-l-accent' : ''"
      >
        <div class="flex items-center gap-2">
          <span class="text-gray-600 font-mono text-xs w-4 flex-shrink-0">{{ idx + 1 }}</span>
          <span class="font-mono text-xs font-bold w-14 flex-shrink-0"
                :class="selectedSymbol === o.ticker ? 'text-accent' : 'text-gray-200'">{{ o.ticker }}</span>

          <span class="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded flex-shrink-0" :class="actionBadge(o.action)">
            {{ o.action }}
          </span>

          <!-- Score bar -->
          <div class="flex-1 flex items-center h-3 relative min-w-[40px]">
            <div class="absolute left-1/2 w-px h-3 bg-surface-300"></div>
            <div
              v-if="o.score >= 0"
              class="absolute bg-bull/50 rounded-r h-1.5"
              :style="{ left: '50%', width: Math.min(50, Math.abs(o.score) / 2) + '%' }"
            ></div>
            <div
              v-else
              class="absolute bg-bear/50 rounded-l h-1.5"
              :style="{ right: '50%', width: Math.min(50, Math.abs(o.score) / 2) + '%' }"
            ></div>
          </div>
          <span class="font-mono text-xs w-8 text-right flex-shrink-0"
                :class="o.score > 0 ? 'text-bull' : o.score < 0 ? 'text-bear' : 'text-gray-500'">
            {{ o.score > 0 ? '+' : '' }}{{ o.score }}
          </span>

          <!-- Trade levels (only for actionable calls) -->
          <span v-if="o.rr" class="font-mono text-[10px] text-gray-500 w-14 text-right flex-shrink-0 hidden sm:inline">
            R:R {{ o.rr.toFixed(1) }}
          </span>

          <!-- Earnings warning -->
          <span
            v-if="o.earningsInDays != null && o.earningsInDays >= 0 && o.earningsInDays <= 7"
            class="text-[10px] font-mono px-1 py-0.5 rounded flex-shrink-0"
            :class="o.earningsInDays <= 2 ? 'bg-neutral/20 text-neutral' : 'bg-surface-300 text-gray-400'"
            :title="'Earnings ' + (o.earningsDate || '')"
          >E{{ o.earningsInDays === 0 ? '!' : '-' + o.earningsInDays }}</span>

          <!-- News pulse -->
          <span v-if="o.buzz >= 1.8 && o.newsCount >= 3" class="text-[10px] font-mono flex-shrink-0"
                :class="o.newsScore > 0 ? 'text-bull' : o.newsScore < 0 ? 'text-bear' : 'text-gray-500'"
                :title="'News flow ' + o.buzz + '× normal'">📰{{ o.buzz.toFixed(0) }}×</span>
        </div>

        <!-- Top reason + entry/stop/target -->
        <div class="flex items-center gap-2 mt-0.5 pl-6 text-[10px] font-mono text-gray-500">
          <span class="truncate flex-1" :title="o.reasons?.join(' · ')">{{ o.reasons?.[0] || '' }}</span>
          <span v-if="o.entry && o.action !== 'HOLD'" class="flex-shrink-0 text-gray-400 hidden md:inline">
            in {{ fmt(o.entry) }} · stop {{ fmt(o.stop) }} · tgt {{ fmt(o.target) }}
          </span>
        </div>
      </button>
    </div>

    <!-- Model tab -->
    <div v-else class="panel-scroll flex-1 min-h-0">
      <AccuracyTracker />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useScannerStore } from '../../stores/scannerStore.js';
import { useMarketStore } from '../../stores/marketStore.js';
import AccuracyTracker from '../predictions/AccuracyTracker.vue';

const scanner = useScannerStore();
const market = useMarketStore();

const tab = ref('opportunities');
const opportunities = computed(() => scanner.opportunities);
const loading = computed(() => scanner.loading.scan);
const running = computed(() => scanner.loading.running);
const lastScanAgo = computed(() => scanner.lastScanAgo);
const selectedSymbol = computed(() => market.selectedSymbol);

function actionBadge(action) {
  if (action === 'BUY') return 'bg-bull/15 text-bull border border-bull/30';
  if (action === 'SELL') return 'bg-bear/15 text-bear border border-bear/30';
  return 'bg-surface-300 text-gray-400 border border-surface-300';
}

function fmt(v) {
  return v != null ? '$' + Number(v).toFixed(2) : '—';
}

async function select(ticker) {
  await market.selectSymbol(ticker);
}

async function rescan() {
  await scanner.runScan();
}
</script>
