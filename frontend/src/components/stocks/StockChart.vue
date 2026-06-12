<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0 gap-2">
      <div class="flex items-center gap-3 min-w-0">
        <div class="truncate">
          <span class="font-mono text-sm font-bold text-white">{{ quote?.symbol || symbol }}</span>
          <span class="text-gray-500 text-xs ml-2 hidden lg:inline">{{ quote?.name }}</span>
        </div>
        <div v-if="quote" class="flex items-center gap-2 flex-shrink-0">
          <span class="font-mono text-base font-bold text-white" :class="priceFlash">${{ (quote.price || 0).toFixed(2) }}</span>
          <span class="font-mono text-sm font-semibold" :class="(quote.changePct || 0) >= 0 ? 'text-bull' : 'text-bear'">
            {{ (quote.changePct || 0) >= 0 ? '+' : '' }}{{ (quote.changePct || 0).toFixed(2) }}%
          </span>
        </div>
      </div>

      <!-- Timeframe buttons -->
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <button
          v-for="tf in timeframes"
          :key="tf.label"
          @click="setTimeframe(tf)"
          class="text-xs px-1.5 py-1 rounded font-mono transition-colors"
          :class="activeTf === tf.label ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
        >
          {{ tf.label }}
        </button>
      </div>
    </div>

    <!-- Chart -->
    <div class="flex-1 relative min-h-0">
      <div ref="chartContainer" class="absolute inset-0"></div>

      <!-- OHLC crosshair legend -->
      <div v-if="legend" class="absolute top-2 left-2 z-10 font-mono text-xs pointer-events-none flex flex-wrap gap-x-2 gap-y-0.5 bg-surface-100/80 px-2 py-1 rounded border border-surface-300/50">
        <span class="text-gray-500">O <span class="text-gray-200">{{ legend.open }}</span></span>
        <span class="text-gray-500">H <span class="text-bull">{{ legend.high }}</span></span>
        <span class="text-gray-500">L <span class="text-bear">{{ legend.low }}</span></span>
        <span class="text-gray-500">C <span class="text-gray-200">{{ legend.close }}</span></span>
        <span v-if="legend.changePct !== null" :class="legend.changePct >= 0 ? 'text-bull' : 'text-bear'">
          {{ legend.changePct >= 0 ? '+' : '' }}{{ legend.changePct }}%
        </span>
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
          Retrying{{ retryAttempt > 0 ? ` (${retryAttempt})` : '' }}…
        </span>
        <button v-else @click="retryLoad" class="text-accent hover:text-accent/70 border border-accent/30 rounded px-3 py-1.5 mt-1">
          Retry now
        </button>
      </div>
    </div>

    <!-- Prediction legend (when targets are drawn on chart) -->
    <div v-if="showPredictions && predictionLegend.length" class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-surface-300/50 flex-shrink-0 text-xs font-mono">
      <div v-for="item in predictionLegend" :key="item.horizon" class="flex items-center gap-1.5">
        <span class="w-3 h-0.5 rounded" :style="{ backgroundColor: item.color }"></span>
        <span class="text-gray-500">{{ item.label }}</span>
        <span :class="item.textColor">${{ item.price }}</span>
        <span class="text-gray-600">by {{ item.date }}</span>
      </div>
    </div>

    <!-- Indicator strip (hidden on simplified stock view) -->
    <div v-else-if="indicators" class="flex gap-3 px-3 py-1.5 border-t border-surface-300/50 flex-shrink-0 text-xs font-mono overflow-x-auto">
      <div v-if="indicators.rsi !== null" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-gray-500">RSI</span><span :class="rsiColor">{{ indicators.rsi?.toFixed(1) }}</span>
      </div>
      <div v-if="indicators.macd" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-gray-500">MACD</span>
        <span :class="indicators.macd.histogram >= 0 ? 'text-bull' : 'text-bear'">{{ indicators.macd.histogram?.toFixed(3) }}</span>
      </div>
      <div v-if="indicators.sma20" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-accent">━</span><span class="text-gray-500">SMA20</span><span class="text-gray-300">${{ indicators.sma20?.toFixed(2) }}</span>
      </div>
      <div v-if="indicators.sma50" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-purple-400">━</span><span class="text-gray-500">SMA50</span><span class="text-gray-300">${{ indicators.sma50?.toFixed(2) }}</span>
      </div>
      <div v-if="indicators.sma200" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-amber-400">━</span><span class="text-gray-500">SMA200</span><span class="text-gray-300">${{ indicators.sma200?.toFixed(2) }}</span>
      </div>
      <div v-if="indicators.atr" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-gray-500">ATR</span><span class="text-gray-300">${{ indicators.atr?.toFixed(2) }}</span>
      </div>
      <div v-if="indicators.bb" class="flex items-center gap-1 flex-shrink-0">
        <span class="text-gray-500">%B</span><span :class="bbColor">{{ (indicators.bb.pctB * 100).toFixed(0) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { createChart, CrosshairMode, ColorType } from 'lightweight-charts';
import { useMarketStore } from '../../stores/marketStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';

const props = defineProps({
  symbol: String,
  showPredictions: { type: Boolean, default: false }
});

const marketStore = useMarketStore();
const predictionStore = usePredictionStore();

const quote = computed(() => marketStore.selectedQuote);
const loading = computed(() => marketStore.loading.historical);
const indicators = computed(() => predictionStore.currentPrediction?.indicators || null);

// Timeframes: intraday fetched per range; daily loads deep history once then slices locally
const DAILY_DEEP_DAYS = 5000;
const DAILY_INITIAL_DAYS = 400;
const timeframes = [
  { label: '1D', interval: '15min', count: 78 },
  { label: '1W', interval: '1h', count: 120 },
  { label: '1M', interval: '1day', count: 21 },
  { label: '3M', interval: '1day', count: 63 },
  { label: '6M', interval: '1day', count: 126 },
  { label: '1Y', interval: '1day', count: 252 },
  { label: '5Y', interval: '1day', count: 1260 },
  { label: 'MAX', interval: '1day', count: DAILY_DEEP_DAYS }
];
const activeTf = ref('1Y');
const legend = ref(null);
const priceFlash = ref('');
let prevPrice = null;

const chartContainer = ref(null);
const predictionLegend = ref([]);
const autoRetrying = ref(false);
const retryAttempt = ref(0);
let chart, candleSeries, volumeSeries, sma20Series, sma50Series, sma200Series, forecastSeries, ro;
let lastBar = null; // most recent candle, mutated live by streamed trades
let priceLines = [];
let retryTimer = null;
let loadGeneration = 0;

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

const HORIZON_STYLE = {
  '1d':  { color: '#58a6ff', label: '1 day' },
  '5d':  { color: '#00d488', label: '5 days' },
  '30d': { color: '#a855f7', label: '30 days' }
};

const chartError = computed(() => {
  if (!loading.value && marketStore.historicalData.length === 0) {
    return marketStore.error || 'No chart data available';
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

  sma20Series = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  sma50Series = chart.addLineSeries({ color: '#a855f7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  sma200Series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  forecastSeries = chart.addLineSeries({
    color: '#00d4ff88', lineWidth: 2, lineStyle: 2,
    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true
  });

  chart.subscribeCrosshairMove(onCrosshair);
}

function clearPredictionOverlay() {
  for (const pl of priceLines) {
    try { candleSeries?.removePriceLine(pl); } catch { /* ignore */ }
  }
  priceLines = [];
  forecastSeries?.setData([]);
  predictionLegend.value = [];
}

function dateToUnix(dateStr) {
  return Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function applyPredictionOverlay(candles) {
  clearPredictionOverlay();
  if (!props.showPredictions || !candleSeries || !candles?.length) return;

  const pred = predictionStore.currentPrediction;
  if (!pred?.predictions?.length || pred.ticker !== (props.symbol || '').toUpperCase()) return;

  const currentPrice = candles[candles.length - 1].close;
  const lastTime = candles[candles.length - 1].time;
  const forecastPoints = [{ time: lastTime, value: currentPrice }];
  const markers = [];

  for (const p of [...pred.predictions].sort((a, b) => {
    const order = { '1d': 1, '5d': 2, '30d': 3 };
    return (order[a.horizon] || 99) - (order[b.horizon] || 99);
  })) {
    const style = HORIZON_STYLE[p.horizon] || { color: '#8b949e', label: p.horizon };
    const target = p.targetPrice;
    if (!target) continue;

    const textColor = p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral';
    predictionLegend.value.push({
      horizon: p.horizon,
      label: style.label,
      price: target.toFixed(2),
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
      title: `${style.label} $${target.toFixed(0)}`
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
          text: `${style.label} $${target.toFixed(0)}`
        });
      }
    }
  }

  if (forecastPoints.length > 1) {
    forecastPoints.sort((a, b) => a.time - b.time);
    forecastSeries.setData(forecastPoints);
  }
  if (markers.length) {
    candleSeries.setMarkers(markers);
    chart.timeScale().applyOptions({ rightOffset: 15 });
  }
}

function smaLine(candles, period) {
  if (candles.length < period) return [];
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: +(sum / period).toFixed(4) });
  }
  return out;
}

function activeTimeframe() {
  return timeframes.find(t => t.label === activeTf.value) || timeframes[5];
}

function visibleCandles(raw) {
  if (!raw?.length) return [];
  const tf = activeTimeframe();
  if (tf.interval === '1day') return raw.slice(-Math.min(tf.count, raw.length));
  return raw;
}

function renderData() {
  const raw = visibleCandles(marketStore.historicalData);
  if (!chart || !candleSeries) return;
  if (!raw?.length) {
    candleSeries.setData([]); volumeSeries.setData([]); sma20Series.setData([]); sma50Series.setData([]); sma200Series.setData([]);
    clearPredictionOverlay();
    return;
  }
  const isIntraday = marketStore.chartInterval && marketStore.chartInterval !== '1day';
  chart.applyOptions({ timeScale: { timeVisible: !!isIntraday, secondsVisible: false } });

  const candles = [], volumes = [];
  for (const c of raw) {
    const base = isIntraday ? c.date.replace(' ', 'T') : c.date + 'T00:00:00';
    const t = Math.floor(Date.parse(base + 'Z') / 1000);
    candles.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
    volumes.push({ time: t, value: c.volume, color: c.close >= c.open ? 'rgba(0,212,136,0.28)' : 'rgba(255,77,77,0.28)' });
  }
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  if (isIntraday) {
    sma20Series.setData([]); sma50Series.setData([]); sma200Series.setData([]);
  } else {
    sma20Series.setData(smaLine(candles, 20));
    sma50Series.setData(smaLine(candles, 50));
    sma200Series.setData(candles.length >= 200 ? smaLine(candles, 200) : []);
  }
  lastBar = candles.length ? { ...candles[candles.length - 1] } : null;
  applyPredictionOverlay(candles);
  chart.timeScale().fitContent();
}

function onCrosshair(param) {
  const c = param?.seriesData?.get(candleSeries);
  if (!param.time || !c) { legend.value = null; return; }
  const changePct = c.open ? ((c.close - c.open) / c.open) * 100 : null;
  legend.value = {
    open: c.open.toFixed(2), high: c.high.toFixed(2), low: c.low.toFixed(2), close: c.close.toFixed(2),
    changePct: changePct !== null ? +changePct.toFixed(2) : null
  };
}

async function loadTimeframe(tf) {
  const sym = props.symbol || marketStore.selectedSymbol;
  const prevInterval = marketStore.chartInterval;
  activeTf.value = tf.label;

  if (tf.interval === '1day') {
    marketStore.chartInterval = '1day';
    const fetchDays = tf.count >= 1260 ? DAILY_DEEP_DAYS : DAILY_INITIAL_DAYS;
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

// Redraw targets when predictions arrive or update
watch(
  () => predictionStore.currentPrediction,
  () => {
    if (!chart || !marketStore.historicalData?.length) return;
    const isIntraday = marketStore.chartInterval && marketStore.chartInterval !== '1day';
    const candles = [];
    for (const c of marketStore.historicalData) {
      const base = isIntraday ? c.date.replace(' ', 'T') : c.date + 'T00:00:00';
      const t = Math.floor(Date.parse(base + 'Z') / 1000);
      candles.push({ time: t, close: c.close });
    }
    applyPredictionOverlay(candles);
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

const rsiColor = computed(() => {
  const r = indicators.value?.rsi;
  if (!r) return 'text-gray-400';
  if (r > 70) return 'text-bear';
  if (r < 30) return 'text-bull';
  return 'text-gray-300';
});
const bbColor = computed(() => {
  const pctB = indicators.value?.bb?.pctB;
  if (pctB == null) return 'text-gray-400';
  if (pctB > 0.8) return 'text-bear';
  if (pctB < 0.2) return 'text-bull';
  return 'text-gray-300';
});
</script>
