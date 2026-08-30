<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div
      class="flex items-center px-3 py-2 border-b border-surface-300 flex-shrink-0 gap-1.5 sm:gap-2"
      :class="hideQuote ? 'justify-end' : 'flex-col sm:flex-row sm:justify-between'"
    >
      <div v-if="!hideQuote" class="flex items-center gap-2 sm:gap-3 min-w-0 w-full sm:w-auto">
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
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
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

function dateToUnix(dateStr) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
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

function applyScaleForTargets(targets) {
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
      const pad = Math.max((max - min) * 0.06, 0.5);
      return { priceRange: { minValue: min - pad, maxValue: max + pad } };
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
  const forecastPoints = [{ time: lastTime, value: currentPrice }];
  const markers = [];
  const currency = quote.value?.currency;

  for (const p of [...targets].sort((a, b) => {
    const order = { '1d': 1, '5d': 2, '30d': 3 };
    return (order[a.horizon] || 99) - (order[b.horizon] || 99);
  })) {
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
      title: `${style.label} ${formatPrice(target, currency)}`
    }));

    if (p.targetDate) {
      const t = dateToUnix(p.targetDate);
      if (t > lastTime) {
        forecastPoints.push({ time: t, value: target });
        markers.push({
          time: t,
          position: p.prediction === 'DOWN' ? 'aboveBar' : 'belowBar',
          color: style.color,
          shape: 'circle',
          text: `${style.label} ${formatPrice(target, currency)}`
        });
      }
    }
  }

  applyScaleForTargets(targets);

  if (forecastPoints.length > 1) {
    forecastPoints.sort((a, b) => a.time - b.time);
    forecastSeries.setData(forecastPoints);
  }
  if (markers.length) {
    candleSeries.setMarkers(markers);
    chart.timeScale().applyOptions({ rightOffset: 15 });
  }
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
