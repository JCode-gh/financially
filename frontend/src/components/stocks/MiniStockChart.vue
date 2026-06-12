<template>
  <button
    type="button"
    @click="openDetail"
    class="card flex flex-col h-[200px] overflow-hidden text-left hover:border-accent/30 transition-colors w-full"
  >
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300/50 flex-shrink-0 gap-2">
      <div class="min-w-0 truncate">
        <span class="font-mono text-sm font-bold text-white">{{ symbol }}</span>
        <span v-if="displayName" class="text-gray-500 text-xs ml-1.5 hidden sm:inline">{{ displayName }}</span>
      </div>
      <div v-if="displayPrice != null" class="flex items-center gap-1.5 flex-shrink-0 font-mono">
        <span class="text-sm font-semibold text-white">${{ displayPrice.toFixed(2) }}</span>
        <span class="text-xs" :class="displayChangePct >= 0 ? 'text-bull' : 'text-bear'">
          {{ displayChangePct >= 0 ? '+' : '' }}{{ displayChangePct.toFixed(2) }}%
        </span>
      </div>
    </div>

    <div class="flex-1 relative min-h-0">
      <div ref="chartContainer" class="absolute inset-0"></div>

      <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-surface-100/40 z-10">
        <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>

      <div v-if="error && !loading" class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-500 text-[10px] font-mono z-10 px-2 text-center">
        <span>{{ error }}</span>
        <span v-if="autoRetrying" class="text-gray-600 animate-pulse">Retrying…</span>
      </div>
    </div>
  </button>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { createChart, ColorType } from 'lightweight-charts';
import { stocksApi } from '../../services/api.js';

const props = defineProps({
  symbol: { type: String, required: true },
  quote: { type: Object, default: null },
  staggerIndex: { type: Number, default: 0 }
});

const router = useRouter();
const chartContainer = ref(null);
const candles = ref([]);
const loading = ref(false);
const error = ref(null);
const autoRetrying = ref(false);

let chart, candleSeries, ro;
let reqId = 0;
let loadGeneration = 0;
let retryTimer = null;
let retryAttempt = 0;

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 20000;
const HISTORY_DAYS = 63;

const displayName = computed(() => props.quote?.name || null);

const displayPrice = computed(() => {
  if (props.quote?.price != null) return props.quote.price;
  const c = candles.value;
  if (!c.length) return null;
  return c[c.length - 1].close;
});

const displayChangePct = computed(() => {
  if (props.quote?.changePct != null) return props.quote.changePct;
  const c = candles.value;
  if (c.length < 2) return 0;
  const last = c[c.length - 1].close;
  const prev = c[c.length - 2].close;
  return prev ? ((last - prev) / prev) * 100 : 0;
});

function clearAutoRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
  autoRetrying.value = false;
}

function buildChart() {
  if (!chartContainer.value) return;
  const rect = chartContainer.value.getBoundingClientRect();
  chart = createChart(chartContainer.value, {
    width: Math.floor(rect.width) || 200,
    height: Math.floor(rect.height) || 140,
    layout: {
      background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
      textColor: '#8b949e',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9
    },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderVisible: false, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
    handleScroll: false,
    handleScale: false,
    crosshair: { vertLine: { visible: false }, horzLine: { visible: false } }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00d488', downColor: '#ff4d4d',
    borderUpColor: '#00d488', borderDownColor: '#ff4d4d',
    wickUpColor: '#00d488', wickDownColor: '#ff4d4d',
    priceLineVisible: false,
    lastValueVisible: false
  });
}

function renderCandles(raw) {
  if (!candleSeries || !raw?.length) {
    candleSeries?.setData([]);
    return;
  }
  const data = raw.map(c => ({
    time: Math.floor(Date.parse(c.date + 'T00:00:00Z') / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));
  candleSeries.setData(data);
  chart?.timeScale().fitContent();
}

function scheduleAutoRetry() {
  clearAutoRetry();
  if (candles.value.length || loading.value) {
    retryAttempt = 0;
    return;
  }
  const gen = loadGeneration;
  const delay = Math.min(RETRY_BASE_MS * Math.pow(1.5, retryAttempt), RETRY_MAX_MS);
  autoRetrying.value = true;
  retryTimer = setTimeout(() => {
    if (gen !== loadGeneration) return;
    retryAttempt++;
    fetchData();
  }, delay);
}

async function fetchData() {
  const sym = props.symbol;
  if (!sym) return;

  const gen = ++loadGeneration;
  const id = ++reqId;
  loading.value = true;
  error.value = null;
  clearAutoRetry();

  const staggerMs = props.staggerIndex * 100;
  if (staggerMs > 0) await new Promise(r => setTimeout(r, staggerMs));
  if (gen !== loadGeneration) return;

  try {
    const res = await stocksApi.historical(sym, HISTORY_DAYS, '1day');
    if (id !== reqId || gen !== loadGeneration) return;
    if (res.data.success === false || !res.data.data?.length) {
      error.value = res.data.error || 'No data';
      candles.value = [];
      scheduleAutoRetry();
    } else {
      candles.value = res.data.data;
      error.value = null;
      retryAttempt = 0;
      renderCandles(candles.value);
    }
  } catch {
    if (id !== reqId || gen !== loadGeneration) return;
    error.value = 'Failed to load';
    candles.value = [];
    scheduleAutoRetry();
  } finally {
    if (id === reqId && gen === loadGeneration) loading.value = false;
  }
}

function openDetail() {
  router.push({ name: 'stock', params: { symbol: props.symbol } });
}

onMounted(() => {
  buildChart();
  ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const w = Math.floor(e.contentRect.width);
      const h = Math.floor(e.contentRect.height);
      if (w > 0 && h > 0) chart?.applyOptions({ width: w, height: h });
    }
  });
  ro.observe(chartContainer.value);
  fetchData();
});

watch(() => props.symbol, () => {
  loadGeneration++;
  clearAutoRetry();
  retryAttempt = 0;
  candles.value = [];
  fetchData();
});

onUnmounted(() => {
  loadGeneration++;
  clearAutoRetry();
  ro?.disconnect();
  chart?.remove();
  chart = null;
});
</script>
