<template>
  <Teleport to="body">
    <div
      v-if="expanded"
      class="fixed inset-0 z-[60] bg-black/70"
      @click="setExpanded(false)"
    />
  </Teleport>
  <div
    class="flex flex-col overflow-hidden"
    :class="expanded
      ? 'fixed inset-0 z-[70] bg-surface-100 shadow-2xl'
      : flush
        ? 'h-full w-full bg-surface-100'
        : 'card h-full'"
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
      <svg
        ref="forecastLayer"
        class="absolute inset-0 z-[5] pointer-events-none overflow-visible"
        aria-hidden="true"
      ></svg>

      <div
        v-if="predictionLegend.length"
        class="absolute top-2 left-2 z-10 font-mono text-[11px] pointer-events-none flex flex-col gap-0.5 bg-surface-100/85 px-2 py-1.5 border border-surface-300/50"
      >
        <div class="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">{{ $t('chart.forecast') }}</div>
        <div v-for="item in predictionLegend" :key="item.horizon" class="flex items-center gap-1.5">
          <span class="forecast-swatch" :style="{ color: item.color }"></span>
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
      <div class="text-gray-600 uppercase tracking-wide self-center">{{ $t('chart.forecast') }}</div>
      <div v-for="item in predictionLegend" :key="item.horizon" class="flex items-center gap-1.5">
        <span class="forecast-swatch" :style="{ color: item.color }"></span>
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
import { t } from '../../i18n/index.js';

const props = defineProps({
  symbol: String,
  hideQuote: { type: Boolean, default: false },
  flush: { type: Boolean, default: false }
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
const forecastLayer = ref(null);
const predictionLegend = ref([]);
const autoRetrying = ref(false);
const retryAttempt = ref(0);
let chart, candleSeries, volumeSeries, ro;
let lastBar = null; // most recent candle, mutated live by streamed trades
let retryTimer = null;
let loadGeneration = 0;
let forecastBars = [];

const HORIZON_DAYS = { '1d': 1, '5d': 5, '30d': 30 };
const FORECAST_DAYS = 30;
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
  const el = chartContainer.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  chart = createChart(el, {
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
    timeScale: { borderColor: '#21262d', timeVisible: false, secondsVisible: false, rightOffset: 6 }
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00d488', downColor: '#ff4d4d',
    borderUpColor: '#00d488', borderDownColor: '#ff4d4d',
    wickUpColor: '#00d488', wickDownColor: '#ff4d4d'
  });

  volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  chart.timeScale().subscribeVisibleLogicalRangeChange(paintForecastOverlay);
}

function clearPredictionOverlay() {
  forecastBars = [];
  predictionLegend.value = [];
  try { candleSeries?.setMarkers([]); } catch { /* ignore */ }
  try {
    candleSeries?.applyOptions({ autoscaleInfoProvider: (original) => original() });
  } catch { /* ignore */ }
  paintForecastOverlay();
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
  applyRightPad();
  paintForecastOverlay();
}

function onExpandKey(e) {
  if (e.key === 'Escape' && expanded.value) setExpanded(false);
}

function isBusinessDay(time) {
  return time && typeof time === 'object' && time.year != null;
}

function timeToDate(time) {
  if (isBusinessDay(time)) return new Date(Date.UTC(time.year, time.month - 1, time.day));
  return new Date(time * 1000);
}

function dateToTime(date, asBusinessDay) {
  if (asBusinessDay) {
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  return Math.floor(date.getTime() / 1000);
}

function nextSession(time) {
  const asBusinessDay = isBusinessDay(time);
  const d = timeToDate(time);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return dateToTime(d, asBusinessDay);
}

function tradingDaysAhead(time, days) {
  let t = time;
  for (let i = 0; i < days; i++) t = nextSession(t);
  return t;
}

function sortedTargets(targets) {
  const order = { '1d': 1, '5d': 2, '30d': 3 };
  return [...targets].sort((a, b) => (order[a.horizon] || 99) - (order[b.horizon] || 99));
}

function forecastAnchors(lastClose, targets) {
  const anchors = [{ day: 0, price: lastClose }];
  const seen = new Set([0]);
  for (const p of sortedTargets(targets)) {
    const day = HORIZON_DAYS[p.horizon];
    if (day == null || seen.has(day) || p.targetPrice == null) continue;
    seen.add(day);
    anchors.push({ day, price: p.targetPrice });
  }
  return anchors;
}

function horizonAtDay(day) {
  if (day === 1) return '1d';
  if (day === 5) return '5d';
  if (day === 30) return '30d';
  return null;
}

function seedRng(symbol, lastClose, targets) {
  const key = `${symbol || ''}|${Number(lastClose).toFixed(4)}|${targets.map(p => `${p.horizon}:${p.targetPrice}`).join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function historyTape(history, fallbackPrice) {
  const rows = history?.length ? history.slice(-40) : [];
  const last = rows[rows.length - 1];
  const px = last?.close || fallbackPrice || 1;
  if (rows.length < 3) {
    const r = px * 0.012;
    return { dailyStd: r, upWick: r * 0.22, dnWick: r * 0.22, gapFreq: 0.2, gapAbs: 0.0015 };
  }
  const rets = [];
  const upWicks = [];
  const dnWicks = [];
  const gaps = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);
    upWicks.push(Math.max(0, c.high - bodyHigh));
    dnWicks.push(Math.max(0, bodyLow - c.low));
    if (i > 0 && rows[i - 1].close) {
      rets.push(c.close - rows[i - 1].close);
      gaps.push((c.open - rows[i - 1].close) / rows[i - 1].close);
    }
  }
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
  const absGaps = gaps.map(g => Math.abs(g));
  return {
    dailyStd: Math.max(Math.sqrt(variance), px * 0.004),
    upWick: Math.max(median(upWicks), px * 0.001),
    dnWick: Math.max(median(dnWicks), px * 0.001),
    gapFreq: Math.min(0.5, gaps.filter(g => Math.abs(g) > 0.0008).length / gaps.length),
    gapAbs: Math.max(median(absGaps), 0.0008)
  };
}

function bridgeCloses(start, end, steps, sigma, rng) {
  if (steps <= 0) return [];
  if (steps === 1) return [end];
  const walk = [0];
  for (let i = 1; i <= steps; i++) walk[i] = walk[i - 1] + sigma * gauss(rng);
  const out = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push(start + (end - start) * t + (walk[i] - walk[steps] * t));
  }
  out[steps - 1] = end;
  return out;
}

function forecastCloses(lastClose, anchors, tape, rng) {
  const closes = [lastClose];
  let price = lastClose;
  let day = 0;
  for (let i = 1; i < anchors.length; i++) {
    const span = anchors[i].day - day;
    if (span <= 0) continue;
    const next = bridgeCloses(price, anchors[i].price, span, tape.dailyStd, rng);
    for (const p of next) closes.push(p);
    price = anchors[i].price;
    day = anchors[i].day;
  }
  if (day < FORECAST_DAYS) {
    const tail = bridgeCloses(price, price, FORECAST_DAYS - day, tape.dailyStd * 0.85, rng);
    for (const p of tail) closes.push(p);
  }
  return closes.slice(0, FORECAST_DAYS + 1);
}

function sessionCandle(prevClose, close, tape, rng) {
  const gap = rng() < tape.gapFreq ? (rng() * 2 - 1) * tape.gapAbs : 0;
  const open = prevClose * (1 + gap);
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);
  const up = tape.upWick * (0.3 + rng() * 1.5);
  const dn = tape.dnWick * (0.3 + rng() * 1.5);
  return {
    open,
    close,
    high: bodyHigh + up,
    low: Math.max(close * 0.2, bodyLow - dn)
  };
}

function buildForecastCandles(lastCandle, targets, history) {
  if (!lastCandle || !targets?.length) return [];
  const anchors = forecastAnchors(lastCandle.close, targets);
  if (anchors.length < 2) return [];
  const tape = historyTape(history, lastCandle.close);
  const rng = seedRng(props.symbol, lastCandle.close, targets);
  const closes = forecastCloses(lastCandle.close, anchors, tape, rng);
  const bars = [];
  for (let day = 1; day < closes.length && day <= FORECAST_DAYS; day++) {
    const candle = sessionCandle(closes[day - 1], closes[day], tape, rng);
    bars.push({
      time: tradingDaysAhead(lastCandle.time, day),
      ...candle,
      horizon: horizonAtDay(day),
      day
    });
  }
  return bars;
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

function applyScaleForForecast(forecastBars) {
  if (!candleSeries) return;
  const extras = (forecastBars || []).flatMap(c => [c.high, c.low]).filter(n => n != null);
  if (!extras.length) {
    candleSeries.applyOptions({ autoscaleInfoProvider: (original) => original() });
    return;
  }
  candleSeries.applyOptions({
    autoscaleInfoProvider: (original) => {
      const res = original();
      if (!res?.priceRange) return res;
      let min = res.priceRange.minValue;
      let max = res.priceRange.maxValue;
      for (const p of extras) {
        if (p < min) min = p;
        if (p > max) max = p;
      }
      const span = Math.max(max - min, 1);
      return { priceRange: { minValue: min - span * 0.06, maxValue: max + span * 0.16 } };
    }
  });
}

function applyRightPad() {
  if (!chart) return;
  chart.timeScale().applyOptions({
    rightOffset: forecastBars.length ? forecastBars.length + 2 : 4
  });
}

function chartBarSpacing() {
  const ts = chart?.timeScale();
  if (!ts) return 6;
  const fromOpts = ts.options()?.barSpacing;
  if (fromOpts > 0) return fromOpts;
  const range = ts.getVisibleLogicalRange();
  if (range && range.to !== range.from) {
    const a = ts.logicalToCoordinate(range.from);
    const b = ts.logicalToCoordinate(range.from + 1);
    if (a != null && b != null) return Math.abs(b - a);
  }
  return 6;
}

function paintForecastOverlay() {
  const svg = forecastLayer.value;
  if (!svg) return;

  const host = chartContainer.value;
  const rect = host?.getBoundingClientRect();
  const w = Math.floor(rect?.width || 0);
  const h = Math.floor(rect?.height || 0);
  svg.setAttribute('viewBox', `0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`);
  svg.setAttribute('width', String(Math.max(w, 1)));
  svg.setAttribute('height', String(Math.max(h, 1)));

  if (!chart || !candleSeries || !forecastBars.length || !lastBar || w <= 0 || h <= 0) {
    svg.innerHTML = '';
    return;
  }

  const ts = chart.timeScale();
  const lastX = ts.timeToCoordinate(lastBar.time);
  if (lastX == null) {
    svg.innerHTML = '';
    return;
  }

  const lastLogical = ts.coordinateToLogical(lastX);
  if (lastLogical == null) {
    svg.innerHTML = '';
    return;
  }

  const spacing = chartBarSpacing();
  const candleW = Math.max(1, spacing * 0.8);
  const strokeW = spacing >= 8 ? 1.25 : spacing >= 4 ? 1 : 0.7;
  const fontPx = spacing >= 10 ? 10 : spacing >= 6 ? 9 : 0;
  const labelGap = Math.max(3, spacing * 0.4);
  const dividerX = lastX + spacing * 0.5;
  const parts = [
    `<line x1="${dividerX}" y1="8" x2="${dividerX}" y2="${h - 22}" stroke="rgba(139,148,158,0.35)" stroke-dasharray="3 3" stroke-width="1" />`
  ];

  forecastBars.forEach((bar, i) => {
    const x = ts.logicalToCoordinate(lastLogical + 1 + i);
    if (x == null) return;

    const yOpen = candleSeries.priceToCoordinate(bar.open);
    const yClose = candleSeries.priceToCoordinate(bar.close);
    const yHigh = candleSeries.priceToCoordinate(bar.high);
    const yLow = candleSeries.priceToCoordinate(bar.low);
    if ([yOpen, yClose, yHigh, yLow].some(v => v == null)) return;

    const up = bar.close >= bar.open;
    const color = up ? '#00d488' : '#ff4d4d';
    const fill = up ? 'rgba(0,212,136,0.18)' : 'rgba(255,77,77,0.18)';
    const top = Math.min(yOpen, yClose);
    const bodyH = Math.max(Math.abs(yClose - yOpen), strokeW);
    const style = bar.horizon ? HORIZON_STYLE[bar.horizon] : null;
    const labelY = (up || yHigh < fontPx + 6) ? yHigh - labelGap : yLow + labelGap + fontPx;

    parts.push(
      `<line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="${strokeW}" stroke-opacity="0.55" />`,
      `<rect x="${x - candleW / 2}" y="${top}" width="${candleW}" height="${bodyH}" fill="${fill}" stroke="${color}" stroke-width="${strokeW}" />`
    );
    if (fontPx && style) {
      parts.push(
        `<text x="${x}" y="${labelY}" fill="${style.color}" font-size="${fontPx}" font-family="JetBrains Mono, monospace" text-anchor="middle">${style.label}</text>`
      );
    }
  });

  svg.innerHTML = parts.join('');
}

function applyPredictionOverlay(candles) {
  clearPredictionOverlay();
  if (!candleSeries || !candles?.length) return;

  const targets = predictionTargets();
  if (!targets.length) {
    applyScaleForForecast([]);
    return;
  }

  const last = candles[candles.length - 1];
  const currency = quote.value?.currency;
  const sorted = sortedTargets(targets);
  const bars = buildForecastCandles(last, sorted, candles);
  if (!bars.length) return;

  forecastBars = bars;
  applyScaleForForecast(bars);
  applyRightPad();

  for (const p of sorted) {
    const style = HORIZON_STYLE[p.horizon] || { color: '#8b949e', label: p.horizon };
    const textColor = p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral';
    predictionLegend.value.push({
      horizon: p.horizon,
      label: style.label,
      price: formatPrice(p.targetPrice, currency),
      date: formatShortDate(p.targetDate),
      color: style.color,
      textColor
    });
  }

  try {
    candleSeries.setMarkers([{
      time: last.time,
      position: 'aboveBar',
      color: '#8b949e',
      shape: 'circle',
      text: t('chart.now')
    }]);
  } catch { /* ignore */ }

  paintForecastOverlay();
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
    const parsed = new Date(Date.parse(base + 'Z'));
    const t = isIntraday
      ? Math.floor(parsed.getTime() / 1000)
      : { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() };
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
  applyRightPad();
  paintForecastOverlay();
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

onMounted(async () => {
  await nextTick();
  if (!chartContainer.value) return;
  buildChart();
  renderData();
  window.addEventListener('keydown', onExpandKey);
  ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const w = Math.floor(e.contentRect.width), h = Math.floor(e.contentRect.height);
      if (w > 0 && h > 0) {
        chart?.applyOptions({ width: w, height: h });
        paintForecastOverlay();
      }
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
  if (chart && candleSeries) renderData();
}, { immediate: true });

onUnmounted(() => {
  loadGeneration++;
  clearAutoRetry();
  document.body.classList.remove('overflow-hidden');
  window.removeEventListener('keydown', onExpandKey);
  clearPredictionOverlay();
  ro?.disconnect();
  try { chart?.timeScale().unsubscribeVisibleLogicalRangeChange(paintForecastOverlay); } catch { /* ignore */ }
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
    applyRightPad();
    paintForecastOverlay();
  },
  { deep: true, immediate: true }
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

<style scoped>
.forecast-swatch {
  position: relative;
  width: 7px;
  height: 12px;
  flex-shrink: 0;
}
.forecast-swatch::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: currentColor;
  transform: translateX(-50%);
}
.forecast-swatch::after {
  content: '';
  position: absolute;
  left: 1px;
  right: 1px;
  top: 3px;
  bottom: 3px;
  border: 1px solid currentColor;
  background: color-mix(in srgb, currentColor 20%, transparent);
}
</style>
