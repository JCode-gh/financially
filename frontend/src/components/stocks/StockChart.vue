<template>
  <Teleport to="body">
    <div
      v-if="expanded"
      class="fixed inset-0 z-[60] bg-black/70"
      @click="setExpanded(false)"
    />
  </Teleport>
  <div
    class="card flex flex-col overflow-hidden"
    :class="expanded ? 'fixed inset-3 sm:inset-4 z-[70] shadow-2xl' : 'h-full'"
  >
    <!-- Header -->
    <div
      class="flex items-center px-3 py-2 border-b border-surface-300 flex-shrink-0 gap-1.5 sm:gap-2"
      :class="hideQuote && !expanded ? 'justify-end' : 'flex-col sm:flex-row sm:justify-between'"
    >
      <div v-if="!hideQuote || expanded" class="flex items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto">
        <div class="truncate">
          <span class="font-mono text-sm font-bold text-white">{{ quote?.symbol || symbol }}</span>
          <span class="text-gray-500 text-xs ml-2 hidden lg:inline">{{ quote?.name }}</span>
        </div>
        <div v-if="quote" class="flex items-center gap-2 flex-shrink-0">
          <span class="font-mono text-sm sm:text-base font-bold text-white" :class="priceFlash">{{ formatPrice(quote.price, quote.currency) }}</span>
          <span class="font-mono text-xs sm:text-sm font-semibold" :class="(quote.changePct || 0) >= 0 ? 'text-bull' : 'text-bear'">
            {{ formatPct(quote.changePct) }}
          </span>
        </div>
      </div>

      <!-- Timeframe buttons -->
      <div class="flex items-center gap-0.5 flex-shrink-0 overflow-x-auto -mx-1 px-1">
        <button
          v-for="tf in timeframes"
          :key="tf.label"
          @click="setTimeframe(tf)"
          class="text-xs px-1.5 py-1 rounded font-mono transition-colors flex-shrink-0"
          :class="activeTf === tf.label ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ tf.label }}
        </button>
        <button
          type="button"
          class="ml-1 p-1 rounded text-gray-500 hover:text-accent hover:bg-accent/10 transition-colors"
          :aria-label="expanded ? $t('chart.shrink') : $t('chart.enlarge')"
          :title="expanded ? $t('chart.shrink') : $t('chart.enlarge')"
          @click="setExpanded(!expanded)"
        >
          <svg v-if="expanded" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
          <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 relative min-h-0">
      <div ref="chartContainer" class="absolute inset-0"></div>

      <div
        v-if="predictionLegend.length"
        class="absolute top-2 left-2 z-10 font-mono text-[11px] pointer-events-none flex flex-col gap-0.5 bg-surface-100/85 px-2 py-1.5 rounded border border-surface-300/50"
      >
        <div v-for="item in predictionLegend" :key="item.horizon" class="flex items-center gap-1.5">
          <span class="w-3 h-0.5 rounded" :style="{ backgroundColor: item.color }"></span>
          <span class="text-gray-500">{{ item.label }}</span>
          <span :class="item.textColor">{{ item.price }}</span>
        </div>
      </div>

      <!-- Loading overlay -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-20 bg-surface-100/30">
        <div class="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full"></div>
      </div>

      <!-- Error state -->
      <div v-if="chartError && !loading" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500 text-xs font-mono z-10 px-6 text-center">
        <svg class="w-8 h-8 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>{{ chartError }}</span>
        <span v-if="autoRetrying" class="text-gray-600 animate-pulse">
          {{ retryAttempt > 0 ? $t('chart.retrying', { n: retryAttempt }) : $t('common.retrying') }}
        </span>
        <button v-else @click="retryLoad" class="text-accent hover:text-accent/70 border border-accent/30 rounded px-3 py-1.5 mt-1">
          {{ $t('common.retry') }}
        </button>
      </div>
    </div>

    <div v-if="predictionLegend.length" class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-surface-300/50 flex-shrink-0 text-xs font-mono">
      <div v-for="item in predictionLegend" :key="item.horizon" class="flex items-center gap-1.5">
        <span class="w-3 h-0.5 rounded" :style="{ backgroundColor: item.color }"></span>
        <span class="text-gray-500">{{ item.label }}</span>
        <span :class="item.textColor">{{ item.price }}</span>
        <span v-if="item.date" class="text-gray-600">{{ $t('chart.by', { date: item.date }) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch, onMounted, onUnmounted } from 'vue';
import { createChart, CrosshairMode, ColorType } from 'lightweight-charts';
import { useMarketStore } from '../../stores/marketStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { formatPrice, formatPct } from '../../utils/format.js';

const props = defineProps({
  symbol: String,
  hideQuote: { type: Boolean, default: false }
});

const marketStore = useMarketStore();
const predictionStore = usePredictionStore();

const quote = computed(() =>
  marketStore.selectedQuote?.symbol === props.symbol ? marketStore.selectedQuote : null
);
const loading = computed(() => marketStore.loading.historical);

const DAILY_INITIAL_DAYS = 400;
const timeframes = [
  { label: '1M', interval: '1day', count: 21 },
  { label: '6M', interval: '1day', count: 126 },
  { label: '1Y', interval: '1day', count: 252 }
];
const activeTf = ref('1Y');
const expanded = ref(false);
const priceFlash = ref('');
let prevPrice = null;

const chartContainer = ref(null);
const predictionLegend = ref([]);
const autoRetrying = ref(false);
const retryAttempt = ref(0);
let chart, candleSeries, volumeSeries, forecastSeries, ro;
let lastBar = null; // most recent candle, mutated live by streamed trades
let priceLines = [];
let retryTimer = null;
let loadGeneration = 0;

const HORIZON_STYLE = {
  '1d':  { color: '#58a6ff', label: '1d' },
  '5d':  { color: '#00d488', label: '5d' },
  '30d': { color: '#a855f7', label: '30d' }
};

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

function clearAutoRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
  autoRetrying.value = false;
}

function isChartLoadFailed() {
  const sym = props.symbol || marketStore.selectedSymbol;
  if (!sym) return false;
  return !marketStore.loading.historical && marketStore.historicalData.length === 0;
}

function scheduleAutoRetryIfNeeded() {
  clearAutoRetry();
  if (!isChartLoadFailed()) {
    retryAttempt.value = 0;
    return;
  }

  const gen = loadGeneration;
  const delay = Math.min(RETRY_BASE_MS * Math.pow(1.5, retryAttempt.value), RETRY_MAX_MS);
  autoRetrying.value = true;
  retryTimer = setTimeout(async () => {
    if (gen !== loadGeneration) return;
    retryAttempt.value++;
    marketStore.historicalData = [];
    await loadTimeframe(activeTimeframe());
  }, delay);
}

const chartError = computed(() => {
  if (!loading.value && marketStore.historicalData.length === 0) {
    return marketStore.errors.historical || marketStore.error || 'No chart data available';
  }
  return null;
});

function buildChart() {
  const rect = chartContainer.value.getBoundingClientRect();
  chart = createChart(chartContainer.value, {
    width: Math.floor(rect.width) || 600,
    height: Math.floor(rect.height) || 320,
    layout: {
      background: { type: ColorType.Solid, color: 'rgba(0,0,0,0)' },
      textColor: '#8b949e',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10
    },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#00d4ff55', width: 1, style: 2, labelBackgroundColor: '#1f6feb' },
      horzLine: { color: '#00d4ff55', width: 1, style: 2, labelBackgroundColor: '#1f6feb' }
    },
    rightPriceScale: { borderColor: '#21262d', scaleMargins: { top: 0.08, bottom: 0.25 } },
    timeScale: { borderColor: '#21262d', timeVisible: false, secondsVisible: false, rightOffset: 4 }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00d488', downColor: '#ff4d4d',
    borderUpColor: '#00d488', borderDownColor: '#ff4d4d',
    wickUpColor: '#00d488', wickDownColor: '#ff4d4d'
  });

  volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  forecastSeries = chart.addLineSeries({
    color: '#00d4ff88', lineWidth: 2, lineStyle: 2,
    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true
  });
}

function clearPredictionOverlay() {
  for (const pl of priceLines) {
    try { candleSeries?.removePriceLine(pl); } catch { /* ignore */ }
  }
  priceLines = [];
  forecastSeries?.setData([]);
  predictionLegend.value = [];
  try { candleSeries?.setMarkers([]); } catch { /* ignore */ }
}

function resizeChart() {
  const el = chartContainer.value;
  if (!el || !chart) return;
  const r = el.getBoundingClientRect();
  const w = Math.floor(r.width);
  const h = Math.floor(r.height);
  if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
}

async function setExpanded(on) {
  expanded.value = !!on;
  document.body.classList.toggle('overflow-hidden', expanded.value);
  await nextTick();
  resizeChart();
  chart?.timeScale().fitContent();
}

function onExpandKey(e) {
  if (e.key === 'Escape' && expanded.value) setExpanded(false);
}

function dateToUnix(dateStr) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
}

function nextSessionUnix(lastTime) {
  const d = new Date(lastTime * 1000);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return Math.floor(d.getTime() / 1000);
}

function tradingDaysAhead(lastTime, days) {
  let t = lastTime;
  for (let i = 0; i < days; i++) t = nextSessionUnix(t);
  return t;
}

function easeInPath(startTime, endTime, startPrice, endPrice) {
  const span = endTime - startTime;
  const points = [];
  const seen = new Set();
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const time = startTime + Math.round(span * t);
    if (seen.has(time)) continue;
    seen.add(time);
    points.push({ time, value: startPrice + (endPrice - startPrice) * t * t });
  }
  return points;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function predictionTargets() {
  const pred = predictionStore.currentPrediction;
  if (!pred?.predictions?.length) return [];
  if (pred.ticker !== (props.symbol || '').toUpperCase()) return [];
  return pred.predictions.filter(p => p.targetPrice);
}

function applyScaleForTargets(targets, currentPrice) {
  if (!candleSeries) return;
  const prices = targets.map(p => p.targetPrice).filter(n => n != null);
  candleSeries.applyOptions({
    autoscaleInfoProvider: (original) => {
      const res = original();
      if (!res?.priceRange || !prices.length) return res;
      let min = res.priceRange.minValue;
      let max = res.priceRange.maxValue;
      for (const p of prices) {
        if (p < min) min = p;
        if (p > max) max = p;
      }
      const mid = currentPrice ?? (min + max) / 2;
      const span = Math.max(max - min, 1);
      const move = Math.max(...prices.map(p => Math.abs(p - mid)));
      const head = Math.max(span * 0.08, move * 1.35);
      return { priceRange: { minValue: min - span * 0.05, maxValue: max + head } };
    }
  });
}

function applyPredictionOverlay(candles) {
  clearPredictionOverlay();
  if (!candleSeries || !candles?.length) return;

  const targets = predictionTargets();
  if (!targets.length) {
    applyScaleForTargets([]);
    return;
  }

  const currentPrice = candles[candles.length - 1].close;
  const lastTime = candles[candles.length - 1].time;
  const startTime = nextSessionUnix(lastTime);
  const horizonDays = { '1d': 1, '5d': 5, '30d': 30 };
  const currency = quote.value?.currency;
  const sorted = [...targets].sort((a, b) => {
    const order = { '1d': 1, '5d': 2, '30d': 3 };
    return (order[a.horizon] || 99) - (order[b.horizon] || 99);
  });

  for (const p of sorted) {
    const style = HORIZON_STYLE[p.horizon] || { color: '#8b949e', label: p.horizon };
    const target = p.targetPrice;
    const textColor = p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral';
    predictionLegend.value.push({
      horizon: p.horizon,
      label: style.label,
      price: formatPrice(target, currency),
      date: formatShortDate(p.targetDate),
      color: style.color,
      textColor
    });

    priceLines.push(candleSeries.createPriceLine({
      price: target,
      color: style.color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: ''
    }));
  }

  applyScaleForTargets(targets, currentPrice);

  // Path starts on the next unprinted session at the last close, then eases
  // in toward the longest target so a 30-day move does not spike off the last bar.
  const farthest = [...sorted].reverse().find(p => p.targetPrice != null);
  if (!farthest) return;
  const days = horizonDays[farthest.horizon] || 30;
  const endTime = farthest.targetDate
    ? Math.max(dateToUnix(farthest.targetDate), tradingDaysAhead(lastTime, days))
    : tradingDaysAhead(lastTime, days);
  if (endTime <= startTime) return;

  forecastSeries.setData(easeInPath(startTime, endTime, currentPrice, farthest.targetPrice));
}

function activeTimeframe() {
  return timeframes.find(t => t.label === activeTf.value) || timeframes.find(t => t.label === '1Y') || timeframes[0];
}

function visibleCandles(raw) {
  if (!raw?.length) return [];
  const tf = activeTimeframe();
  if (tf.interval === '1day') return raw.slice(-Math.min(tf.count, raw.length));
  return raw;
}

function mappedCandles() {
  const raw = visibleCandles(marketStore.historicalData);
  if (!raw?.length) return { candles: [], volumes: [], isIntraday: false };
  const isIntraday = marketStore.chartInterval && marketStore.chartInterval !== '1day';
  const candles = [], volumes = [];
  for (const c of raw) {
    const base = isIntraday ? c.date.replace(' ', 'T') : c.date + 'T00:00:00';
    const t = Math.floor(Date.parse(base + 'Z') / 1000);
    candles.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    volumes.push({ time: t, value: c.volume, color: c.close >= c.open ? 'rgba(0,212,136,0.28)' : 'rgba(255,77,77,0.28)' });
  }
  return { candles, volumes, isIntraday };
}

function renderData() {
  const { candles, volumes, isIntraday } = mappedCandles();
  if (!chart || !candleSeries) return;
  if (!candles.length) {
    candleSeries.setData([]);
    volumeSeries.setData([]);
    clearPredictionOverlay();
    return;
  }
  chart.applyOptions({ timeScale: { timeVisible: !!isIntraday, secondsVisible: false } });
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  lastBar = { ...candles[candles.length - 1] };
  applyPredictionOverlay(candles);
  chart.timeScale().fitContent();
  chart.timeScale().applyOptions({ rightOffset: 8 });
}

async function loadTimeframe(tf) {
  const sym = props.symbol || marketStore.selectedSymbol;
  const prevInterval = marketStore.chartInterval;
  activeTf.value = tf.label;

  if (tf.interval === '1day') {
    marketStore.chartInterval = '1day';
    const fetchDays = DAILY_INITIAL_DAYS;
    const needFetch = prevInterval !== '1day' || marketStore.historicalData.length < tf.count;
    if (needFetch) {
      await marketStore.fetchHistorical(sym, { days: fetchDays, interval: '1day' });
    } else {
      renderData();
    }
  } else {
    marketStore.chartInterval = tf.interval;
    await marketStore.fetchHistorical(sym, { days: tf.count, interval: tf.interval });
  }

  scheduleAutoRetryIfNeeded();
}

async function setTimeframe(tf) {
  await loadTimeframe(tf);
}

async function retryLoad() {
  clearAutoRetry();
  retryAttempt.value = 0;
  marketStore.historicalData = [];
  await loadTimeframe(activeTimeframe());
}

onMounted(() => {
  buildChart();
  window.addEventListener('keydown', onExpandKey);
  ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const w = Math.floor(e.contentRect.width), h = Math.floor(e.contentRect.height);
      if (w > 0 && h > 0) chart?.applyOptions({ width: w, height: h });
    }
  });
  ro.observe(chartContainer.value);
});

watch(() => props.symbol, async (sym) => {
  if (!sym) return;
  loadGeneration++;
  clearAutoRetry();
  retryAttempt.value = 0;
  await loadTimeframe(activeTimeframe());
}, { immediate: true });

onUnmounted(() => {
  loadGeneration++;
  clearAutoRetry();
  document.body.classList.remove('overflow-hidden');
  window.removeEventListener('keydown', onExpandKey);
  clearPredictionOverlay();
  ro?.disconnect();
  chart?.remove();
  chart = null;
});

// Re-render whenever the store's candle data changes (symbol switch, timeframe, refresh)
watch(() => marketStore.historicalData, renderData, { deep: false });

watch(
  () => predictionStore.currentPrediction,
  () => {
    if (!chart || !candleSeries) return;
    applyPredictionOverlay(mappedCandles().candles);
  },
  { deep: true }
);

// Live: nudge the last candle on each streamed trade for the charted symbol
watch(() => marketStore.liveTick, (tick) => {
  if (!tick || !candleSeries || !lastBar) return;
  if (tick.symbol !== (quote.value?.symbol || props.symbol)) return;
  lastBar.close = tick.price;
  if (tick.price > lastBar.high) lastBar.high = tick.price;
  if (tick.price < lastBar.low) lastBar.low = tick.price;
  candleSeries.update({ ...lastBar });
});

// Flash the header price green/red on each live change
watch(() => quote.value?.price, (p) => {
  if (p == null) return;
  if (prevPrice != null && p !== prevPrice) {
    priceFlash.value = p > prevPrice ? 'flash-up' : 'flash-down';
    setTimeout(() => { priceFlash.value = ''; }, 600);
  }
  prevPrice = p;
});
</script>
