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
          <span class="font-mono text-base font-bold text-white">${{ (quote.price || 0).toFixed(2) }}</span>
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
      <div v-if="chartError && !loading" class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500 text-xs font-mono z-10">
        <svg class="w-8 h-8 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>{{ chartError }}</span>
      </div>
    </div>

    <!-- Indicator strip -->
    <div v-if="indicators" class="flex gap-3 px-3 py-1.5 border-t border-surface-300/50 flex-shrink-0 text-xs font-mono overflow-x-auto">
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

const props = defineProps({ symbol: String });

const marketStore = useMarketStore();
const predictionStore = usePredictionStore();

const quote = computed(() => marketStore.selectedQuote);
const loading = computed(() => marketStore.loading.historical);
const indicators = computed(() => predictionStore.currentPrediction?.indicators || null);

// Timeframes: 1D/1W = intraday; 1M..5Y = daily (counts are trading days/bars)
const timeframes = [
  { label: '1D', interval: '15min', count: 32 },
  { label: '1W', interval: '1h', count: 40 },
  { label: '1M', interval: '1day', count: 21 },
  { label: '3M', interval: '1day', count: 63 },
  { label: '6M', interval: '1day', count: 126 },
  { label: '1Y', interval: '1day', count: 252 },
  { label: '5Y', interval: '1day', count: 1260 }
];
const activeTf = ref('3M');
const legend = ref(null);

const chartContainer = ref(null);
let chart, candleSeries, volumeSeries, sma20Series, sma50Series, ro;

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

  chart.subscribeCrosshairMove(onCrosshair);
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

function renderData() {
  const raw = marketStore.historicalData;
  if (!chart || !candleSeries) return;
  if (!raw?.length) {
    candleSeries.setData([]); volumeSeries.setData([]); sma20Series.setData([]); sma50Series.setData([]);
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
  // SMA overlays only meaningful on daily timeframes
  sma20Series.setData(isIntraday ? [] : smaLine(candles, 20));
  sma50Series.setData(isIntraday ? [] : smaLine(candles, 50));
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

async function setTimeframe(tf) {
  activeTf.value = tf.label;
  marketStore.chartInterval = tf.interval;
  await marketStore.fetchHistorical(marketStore.selectedSymbol, { days: tf.count, interval: tf.interval });
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
  renderData();
});

onUnmounted(() => { ro?.disconnect(); chart?.remove(); chart = null; });

// Re-render whenever the store's candle data changes (symbol switch, timeframe, refresh)
watch(() => marketStore.historicalData, renderData, { deep: false });

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
