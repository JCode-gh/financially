<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-surface-300 flex-shrink-0 gap-3">
      <div class="min-w-0">
        <h1 class="text-sm font-medium text-gray-300">Model picks</h1>
        <p class="text-xs text-gray-500 mt-0.5 truncate">
          High-conviction ideas only — score, R:R, trend &amp; regime gated
        </p>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <span v-if="lastScanAgo" class="text-xs text-gray-600 font-mono hidden sm:inline">Updated {{ lastScanAgo }}</span>
        <button
          @click="rescan"
          :disabled="running"
          class="text-xs px-3 py-1.5 rounded font-mono border transition-colors flex items-center gap-1.5"
          :class="running ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
        >
          <span v-if="running" class="animate-spin inline-block w-3 h-3 border border-accent border-t-transparent rounded-full"></span>
          {{ running ? 'Scanning…' : 'Rescan' }}
        </button>
      </div>
    </div>

    <!-- Model track record -->
    <div v-if="meta" class="px-4 py-2 border-b border-surface-300/50 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-gray-500 flex-shrink-0">
      <span v-if="meta.backtest5d?.total">
        Backtest 5d:
        <span :class="accColor(meta.backtest5d.accuracy)">{{ (meta.backtest5d.accuracy * 100).toFixed(1) }}%</span>
        <span class="text-gray-600"> ({{ meta.backtest5d.total }} calls)</span>
      </span>
      <span v-if="meta.live5d?.total">
        Live 5d:
        <span :class="accColor(meta.live5d.accuracy)">{{ (meta.live5d.accuracy * 100).toFixed(1) }}%</span>
        <span class="text-gray-600"> ({{ meta.live5d.correct }}/{{ meta.live5d.total }})</span>
      </span>
      <span v-if="meta.gates" class="text-gray-600">
        Gates: score ≥{{ (meta.gates.minScore * 100).toFixed(0) }} · conf ≥{{ (meta.gates.minConfidence * 100).toFixed(0) }}% · R:R ≥{{ meta.gates.minRR }}
      </span>
    </div>

    <!-- Filters -->
    <div class="flex gap-1 px-4 py-2 border-b border-surface-300/50 flex-shrink-0 overflow-x-auto">
      <button
        v-for="f in filters"
        :key="f.value"
        @click="activeFilter = f.value"
        class="text-xs px-3 py-1 rounded font-mono transition-colors flex-shrink-0"
        :class="activeFilter === f.value ? f.activeClass : 'text-gray-500 hover:text-gray-300'"
      >
        {{ f.label }}
        <span v-if="f.count != null" class="ml-1 opacity-70">({{ f.count }})</span>
      </button>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto panel-scroll">
      <div v-if="loading || running" class="flex items-center justify-center h-32 gap-2 text-gray-500 text-sm">
        <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full"></div>
        <span>Scanning model universe…</span>
      </div>

      <div v-else-if="!filtered.length" class="flex flex-col items-center justify-center h-40 text-gray-500 text-sm gap-2 px-6 text-center">
        <span v-if="activeFilter === 'actionable'">No high-conviction picks right now</span>
        <span v-else-if="activeFilter === 'watch'">No watchlist candidates</span>
        <span v-else>No scan results yet</span>
        <p v-if="activeFilter === 'actionable'" class="text-xs text-gray-600 max-w-sm">
          The model only surfaces Buy/Sell when score, confidence, risk/reward, trend and market regime all align.
        </p>
        <button @click="rescan" class="text-xs text-accent hover:text-accent/70 mt-1">Run a scan</button>
      </div>

      <button
        v-for="(o, idx) in filtered"
        :key="o.ticker"
        @click="openStock(o.ticker)"
        class="w-full text-left px-4 py-4 border-b border-surface-300/30 hover:bg-surface-200/40 transition-colors"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-gray-600 font-mono text-xs w-5 flex-shrink-0">{{ idx + 1 }}</span>
          <span class="font-mono text-base font-semibold text-white flex-shrink-0">{{ o.ticker }}</span>

          <span class="text-xs font-bold uppercase px-2 py-0.5 rounded flex-shrink-0" :class="actionBadge(o.action)">
            {{ actionLabel(o.action) }}
          </span>

          <span v-if="o.quality === 'high'" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent flex-shrink-0">High conviction</span>
          <span v-else-if="o.quality === 'watch'" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral/10 text-neutral flex-shrink-0">Watch</span>

          <span class="text-[10px] font-mono text-gray-600 ml-auto flex-shrink-0">
            {{ Math.round((o.confidence || 0) * 100) }}% conf · score {{ o.score }}
          </span>
        </div>

        <div class="mt-1.5 pl-7 text-sm text-gray-400 leading-snug">
          {{ o.reasons?.[0] || 'No reason available' }}
        </div>
        <div v-if="o.reasons?.length > 1" class="pl-7 mt-1 text-xs text-gray-600 truncate">
          {{ o.reasons.slice(1, 3).join(' · ') }}
        </div>

        <div v-if="o.flags?.length && !o.actionable" class="pl-7 mt-1.5 text-[10px] font-mono text-gray-600">
          Not actionable: {{ o.flags.slice(0, 2).join(' · ') }}
        </div>

        <div v-if="o.action !== 'HOLD' && o.entry" class="mt-2 pl-7 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-gray-500">
          <span>Entry <span class="text-gray-300">${{ fmt(o.entry) }}</span></span>
          <span>Stop <span class="text-bear">${{ fmt(o.stop) }}</span></span>
          <span>Target <span class="text-bull">${{ fmt(o.target) }}</span></span>
          <span v-if="o.rr">R:R <span :class="o.rr >= 1.5 ? 'text-bull' : 'text-neutral'">{{ o.rr.toFixed(1) }}</span></span>
        </div>

        <div v-if="o.earningsInDays != null && o.earningsInDays >= 0 && o.earningsInDays <= 7" class="mt-1.5 pl-7 text-xs text-neutral font-mono">
          Earnings {{ o.earningsInDays === 0 ? 'today' : `in ${o.earningsInDays} day${o.earningsInDays === 1 ? '' : 's'}` }}
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useScannerStore } from '../stores/scannerStore.js';

const router = useRouter();
const scanner = useScannerStore();

const activeFilter = ref('actionable');
let refreshInterval;

const opportunities = computed(() => scanner.opportunities);
const meta = computed(() => scanner.meta);
const loading = computed(() => scanner.loading.scan);
const running = computed(() => scanner.loading.running);
const lastScanAgo = computed(() => scanner.lastScanAgo);

const filtered = computed(() => {
  const list = opportunities.value;
  if (activeFilter.value === 'actionable') return list.filter(o => o.actionable);
  if (activeFilter.value === 'watch') return list.filter(o => o.quality === 'watch');
  if (activeFilter.value === 'buy') return list.filter(o => o.action === 'BUY');
  if (activeFilter.value === 'sell') return list.filter(o => o.action === 'SELL');
  return list;
});

const filters = computed(() => [
  { value: 'actionable', label: 'Picks', count: scanner.actionable.length, activeClass: 'text-accent bg-accent/10' },
  { value: 'watch', label: 'Watch', count: scanner.watchlist.length, activeClass: 'text-neutral bg-neutral/10' },
  { value: 'buy', label: 'Buy', count: scanner.buys.length, activeClass: 'text-bull bg-bull/10' },
  { value: 'sell', label: 'Sell', count: scanner.sells.length, activeClass: 'text-bear bg-bear/10' },
  { value: 'all', label: 'All', count: opportunities.value.length, activeClass: 'text-gray-300 bg-surface-200' }
]);

function accColor(acc) {
  if (acc == null) return 'text-gray-500';
  if (acc >= 0.55) return 'text-bull';
  if (acc >= 0.48) return 'text-gray-300';
  return 'text-neutral';
}

function actionBadge(action) {
  if (action === 'BUY') return 'bg-bull/15 text-bull border border-bull/30';
  if (action === 'SELL') return 'bg-bear/15 text-bear border border-bear/30';
  return 'bg-neutral/10 text-neutral border border-neutral/30';
}

function actionLabel(action) {
  if (action === 'BUY') return 'Buy';
  if (action === 'SELL') return 'Sell';
  return 'Hold';
}

function fmt(v) {
  return v != null ? Number(v).toFixed(2) : '—';
}

function openStock(ticker) {
  router.push({ name: 'stock', params: { symbol: ticker } });
}

async function rescan() {
  await scanner.runScan();
}

onMounted(async () => {
  await scanner.init();
  refreshInterval = setInterval(() => scanner.refresh(), 5 * 60_000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});
</script>
