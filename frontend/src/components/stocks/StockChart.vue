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
        <span class="w-px h-3 bg-surface-300 mx-1 flex-shrink-0" aria-hidden="true"></span>
        <button
          type="button"
          class="text-xs px-1.5 py-1 rounded font-mono transition-colors flex-shrink-0"
          :class="showForecast ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          :aria-pressed="showForecast"
          :aria-label="showForecast ? $t('chart.hideForecast') : $t('chart.showForecast')"
          :title="showForecast ? $t('chart.hideForecast') : $t('chart.showForecast')"
          @click="toggleForecast"
        >
          {{ $t('chart.forecast') }}
        </button>
        <button
          type="button"
          class="text-xs px-1.5 py-1 rounded font-mono transition-colors flex-shrink-0"
          :class="showNews ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          :aria-pressed="showNews"
          :aria-label="showNews ? $t('chart.hideNewsMarks') : $t('chart.showNewsMarks')"
          :title="showNews ? $t('chart.hideNewsMarks') : $t('chart.showNewsMarks')"
          @click="toggleNews"
        >
          {{ $t('chart.news') }}
        </button>
        <button
          type="button"
          class="ml-0.5 p-1 rounded text-gray-500 hover:text-accent hover:bg-accent/10 transition-colors"
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
        v-if="showForecast && predictionLegend.length"
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

    <div v-if="showForecast && predictionLegend.length" class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 border-t border-surface-300/50 flex-shrink-0 text-xs font-mono">
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
import { setupReason, shortSentence } from '../../utils/picks.js';
import { currentLocale, t } from '../../i18n/index.js';
import { useNewsStore } from '../../stores/newsStore.js';
import { buildForecastPath, nearLevel, sortedTargets } from '../../utils/forecastPath.js';
import { newsApi } from '../../services/api.js';

const props = defineProps({
  symbol: String,
  hideQuote: { type: Boolean, default: false },
  flush: { type: Boolean, default: false }
});

const marketStore = useMarketStore();
const predictionStore = usePredictionStore();
const newsStore = useNewsStore();

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
const CHART_FORECAST_KEY = 'financially.chart.forecast';
const CHART_NEWS_KEY = 'financially.chart.news';

function readChartFlag(key, fallback = true) {
  try {
    const v = localStorage.getItem(key);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* ignore */ }
  return fallback;
}

function persistChartFlag(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ }
}

const activeTf = ref('1Y');
const expanded = ref(false);
const showForecast = ref(readChartFlag(CHART_FORECAST_KEY, true));
const showNews = ref(readChartFlag(CHART_NEWS_KEY, true));
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
let forecastTurns = [];
let forecastLevels = { support: null, resistance: null };
let newsMarks = [];
let chartNewsArticles = [];

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
  forecastTurns = [];
  forecastLevels = { support: null, resistance: null };
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

function reasonDir(text) {
  const s = String(text || '');
  if (/oversold|washed out/i.test(s)) return 1;
  if (/overbought|stretched/i.test(s)) return -1;
  if (/resistance|distribution|death|breakdown|bear|falling|fading|negative|headwind/i.test(s)) return -1;
  if (/support|buyers|golden|breakout|bull|rising|positive|beat|supportive/i.test(s)) return 1;
  if (/\bsell/i.test(s)) return -1;
  return 0;
}

function horizonBias(text, horizon) {
  const s = String(text || '');
  if (horizon === '1d' && /news|stoch|rsi|macd|headline|event/i.test(s)) return 2;
  if (horizon === '5d' && /breakout|momentum|volume|macd|trend/i.test(s)) return 2;
  if (horizon === '30d' && /trend|sma|ema|golden|death|52-week|valuation|growth|quality|drift/i.test(s)) return 2;
  if (/momentum|volume|news|rsi|adx/i.test(s)) return 1;
  return 0;
}

function shortWhy(raw) {
  const line = setupReason(raw) || String(raw || '').replace(/\s+/g, ' ').trim();
  if (!line) return '';
  return line.length > 56 ? `${line.slice(0, 55).trimEnd()}…` : line;
}

function pickWhyLine(pred, dir, horizon) {
  const pool = [
    ...(pred?.ai?.why || []),
    ...(pred?.reasons || []),
    ...(pred?.ai?.catalysts || []),
    ...(pred?.newsSentiment?.topEvents || []).map(e => e?.label),
    pred?.trend?.label
  ].filter(Boolean);

  let best = '';
  let bestScore = -1;
  for (const raw of pool) {
    const line = shortWhy(raw);
    if (!line) continue;
    const rd = reasonDir(raw);
    let score = 1 + horizonBias(raw, horizon);
    if (dir && rd === dir) score += 3;
    if (dir && rd && rd !== dir) score -= 2;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  if (best) return best;
  const h = horizon || '5d';
  if (dir > 0) return t('chart.turn.callUp', { horizon: h });
  if (dir < 0) return t('chart.turn.callDown', { horizon: h });
  return '';
}

function forecastWhyText(anchor, pred, currency) {
  const level = p => formatPrice(p, currency);
  const dir = anchor.outDir || anchor.inDir;
  const support = pred?.indicators?.support;
  const resistance = pred?.indicators?.resistance;
  const rsi = pred?.indicators?.rsi;

  if (anchor.exitWhy === 'fadeResistance' && resistance != null) {
    return t('chart.turn.fadeResistance', { price: level(resistance) });
  }
  if (anchor.exitWhy === 'overbought' && rsi != null) {
    return t('chart.turn.overbought', { n: Math.round(rsi) });
  }
  if (anchor.exitWhy === 'bounceSupport' && support != null) {
    return t('chart.turn.bounceSupport', { price: level(support) });
  }
  if (anchor.exitWhy === 'oversold' && rsi != null) {
    return t('chart.turn.oversold', { n: Math.round(rsi) });
  }
  if (anchor.kind === 'test' && resistance != null && nearLevel(anchor.price, resistance, 0.03)) {
    return t('chart.turn.testResistance', { price: level(resistance) });
  }
  if (anchor.kind === 'test' && support != null && nearLevel(anchor.price, support, 0.03)) {
    return t('chart.turn.testSupport', { price: level(support) });
  }
  if (anchor.kind === 'pullback') {
    return t('chart.turn.pullback');
  }
  if (anchor.kind === 'fade' && resistance != null) {
    return t('chart.turn.fadeResistance', { price: level(resistance) });
  }
  if (anchor.kind === 'bounce' && support != null) {
    return t('chart.turn.bounceSupport', { price: level(support) });
  }
  if (anchor.kind === 'resume' && dir > 0) {
    return t('chart.turn.resumeUp', { why: pickWhyLine(pred, 1, '30d') });
  }
  if (anchor.kind === 'resume' && dir < 0) {
    return t('chart.turn.resumeDown', { why: pickWhyLine(pred, -1, '30d') });
  }

  if (anchor.kind === 'now') {
    const why = pickWhyLine(pred, dir, '1d');
    if (dir > 0) return t('chart.turn.up', { why });
    if (dir < 0) return t('chart.turn.down', { why });
    return t('chart.turn.flat');
  }

  if (anchor.inDir > 0 && anchor.outDir < 0) {
    if (nearLevel(anchor.price, resistance, 0.03) && resistance != null) {
      return t('chart.turn.fadeResistance', { price: level(resistance) });
    }
    if (rsi != null && rsi >= 70) return t('chart.turn.overbought', { n: Math.round(rsi) });
    return t('chart.turn.reversalDown', { why: pickWhyLine(pred, -1, anchor.horizon || '5d') });
  }
  if (anchor.inDir < 0 && anchor.outDir > 0) {
    if (nearLevel(anchor.price, support, 0.03) && support != null) {
      return t('chart.turn.bounceSupport', { price: level(support) });
    }
    if (rsi != null && rsi <= 30) return t('chart.turn.oversold', { n: Math.round(rsi) });
    return t('chart.turn.reversalUp', { why: pickWhyLine(pred, 1, anchor.horizon || '5d') });
  }

  const why = pickWhyLine(pred, dir, anchor.horizon || '30d');
  if (dir > 0) return t('chart.turn.targetUp', { horizon: anchor.horizon || '30d', why });
  if (dir < 0) return t('chart.turn.targetDown', { horizon: anchor.horizon || '30d', why });
  return why || t('chart.turn.target', { horizon: anchor.horizon || '30d' });
}

function labelForecastAnchors(anchors, pred, currency) {
  const turns = [];
  for (let i = 0; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const nxt = anchors[i + 1];
    const a = anchors[i];
    a.inDir = prev ? Math.sign(a.price - prev.price) : 0;
    a.outDir = nxt ? Math.sign(nxt.price - a.price) : 0;
    const reversal = !!(a.inDir && a.outDir && a.inDir !== a.outDir);
    const structural = a.kind === 'bounce' || a.kind === 'fade' || a.kind === 'resume'
      || a.kind === 'test' || a.kind === 'pullback' || !!a.exitWhy;
    a.showWhy = i === 0 || reversal || structural;
  }
  const marked = anchors.filter(a => a.showWhy);
  if (marked.length < 2 && anchors.length) anchors[anchors.length - 1].showWhy = true;

  for (const a of anchors) {
    if (!a.showWhy) continue;
    const dir = a.outDir || a.inDir;
    turns.push({
      day: a.day,
      price: a.price,
      why: forecastWhyText(a, pred, currency),
      horizon: a.horizon || (a.kind === 'now' ? 'now' : null),
      dir,
      inDir: a.inDir,
      outDir: a.outDir,
      kind: a.kind || 'horizon'
    });
  }
  return turns;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildForecastCandles(lastCandle, targets, history, pred) {
  if (!lastCandle || !targets?.length) return { bars: [], turns: [] };
  const { bars, anchors } = buildForecastPath({
    lastCandle,
    targets,
    history,
    pred,
    symbol: props.symbol
  });
  if (!bars.length) return { bars: [], turns: [] };
  const turns = labelForecastAnchors(anchors, pred, quote.value?.currency);
  return {
    bars: bars.map(bar => ({
      ...bar,
      time: tradingDaysAhead(lastCandle.time, bar.day)
    })),
    turns
  };
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

const NEWS_NOISE = /\b(stocks to watch|top (gainers|losers|picks)|market (wrap|recap|today)|what to (know|watch)|best stocks|week ahead|premarket|after hours)\b/i;

function candleDateKey(time) {
  if (isBusinessDay(time)) {
    const m = String(time.month).padStart(2, '0');
    const d = String(time.day).padStart(2, '0');
    return `${time.year}-${m}-${d}`;
  }
  if (time == null) return '';
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function articleSessionKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getUTCHours() >= 21) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function resolveSession(key, byDay) {
  if (!key) return '';
  if (byDay.has(key)) return key;
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  const prev = d.toISOString().slice(0, 10);
  return byDay.has(prev) ? prev : '';
}

function candleDir(candle, prev) {
  if (prev?.close) {
    const ret = candle.close / prev.close - 1;
    if (Math.abs(ret) >= 0.0005) return ret >= 0 ? 1 : -1;
  }
  return candle.close >= candle.open ? 1 : -1;
}

function newsArticlePool() {
  const seen = new Set();
  const out = [];
  for (const a of [...(chartNewsArticles || []), ...(newsStore.stockArticles || [])]) {
    const key = String(a?.url || a?.headline || a?.title || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function newsEventLabel(article) {
  const ev = (article.events || []).sort((a, b) => Math.abs(b.impact || 0) - Math.abs(a.impact || 0))[0];
  if (ev?.id) {
    const key = `picks.events.${ev.id}`;
    const label = t(key);
    if (label && label !== key) return label;
  }
  return ev?.label || '';
}

function newsTone(article) {
  const ev = (article.events || []).reduce((s, e) => s + (Number(e.impact) || 0), 0);
  const sent = Number(article.sentiment?.score || 0);
  const raw = ev || sent;
  if (raw > 0.12) return 1;
  if (raw < -0.12) return -1;
  return 0;
}

function newsStrength(article) {
  const ev = (article.events || []).reduce((s, e) => s + Math.abs(Number(e.impact) || 0), 0);
  const sent = Math.abs(Number(article.sentiment?.score || 0));
  return ev * 1.4 + sent;
}

function pickNewsMarks(candles) {
  if (!candles?.length) return [];
  const articles = newsArticlePool().filter(a => {
    const title = a.headline || a.title || '';
    if (title.length < 12 || NEWS_NOISE.test(title)) return false;
    return !!a.publishedAt;
  });
  if (!articles.length) return [];

  const byDay = new Map();
  for (let i = 0; i < candles.length; i++) {
    const key = candleDateKey(candles[i].time);
    if (key) byDay.set(key, { candle: candles[i], prev: candles[i - 1] || null });
  }

  const bestByDay = new Map();
  for (const article of articles) {
    const key = resolveSession(articleSessionKey(article.publishedAt), byDay);
    const row = byDay.get(key);
    if (!row) continue;
    const dir = candleDir(row.candle, row.prev);
    const tone = newsTone(article);
    const score = newsStrength(article) + (tone === dir ? 0.5 : 0);
    const cur = bestByDay.get(key);
    if (cur && cur.score >= score) continue;
    const event = newsEventLabel(article);
    const title = shortSentence(article.headline || article.title || '', 46);
    bestByDay.set(key, {
      time: row.candle.time,
      price: dir > 0 ? row.candle.high : row.candle.low,
      dir,
      score,
      event,
      title,
      url: article.url || article.link || '',
      why: event || title
    });
  }

  return [...bestByDay.values()].sort((a, b) => candleDateKey(a.time).localeCompare(candleDateKey(b.time)));
}

function rebuildNewsMarks(candles, isIntraday) {
  newsMarks = isIntraday ? [] : pickNewsMarks(candles);
}

function overlayForecastOn() {
  return !!showForecast.value;
}

function overlayNewsOn() {
  return !!showNews.value;
}

function markNowBar() {
  if (!candleSeries || !lastBar || !overlayForecastOn() || !forecastBars.length) {
    try { candleSeries?.setMarkers([]); } catch { /* ignore */ }
    return;
  }
  try {
    candleSeries.setMarkers([{
      time: lastBar.time,
      position: 'aboveBar',
      color: '#8b949e',
      shape: 'circle',
      text: t('chart.now')
    }]);
  } catch { /* ignore */ }
}

function refreshOverlayChrome() {
  applyScaleForForecast(overlayForecastOn() ? forecastBars : []);
  applyRightPad();
  markNowBar();
  paintForecastOverlay();
}

function toggleForecast() {
  showForecast.value = !showForecast.value;
  persistChartFlag(CHART_FORECAST_KEY, showForecast.value);
  refreshOverlayChrome();
}

function toggleNews() {
  showNews.value = !showNews.value;
  persistChartFlag(CHART_NEWS_KEY, showNews.value);
  refreshOverlayChrome();
}

function applyScaleForForecast(bars) {
  if (!candleSeries) return;
  const useBars = overlayForecastOn() ? (bars || forecastBars) : [];
  const turns = overlayForecastOn() ? forecastTurns : [];
  const levels = overlayForecastOn() ? forecastLevels : { support: null, resistance: null };
  const marks = overlayNewsOn() ? newsMarks : [];
  const extras = useBars.flatMap(c => [c.high, c.low]).filter(n => n != null);
  for (const turn of turns) {
    if (turn.price != null) extras.push(turn.price);
  }
  for (const p of [levels.support, levels.resistance]) {
    if (p != null) extras.push(p);
  }
  for (const m of marks) {
    if (m.price != null) extras.push(m.price);
  }
  const labeled = turns.length || marks.length;
  if (!extras.length && !labeled) {
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
      const topPad = labeled ? 0.48 : 0.16;
      const botPad = labeled ? 0.22 : 0.08;
      return { priceRange: { minValue: min - span * botPad, maxValue: max + span * topPad } };
    }
  });
}

function applyRightPad() {
  if (!chart) return;
  const n = overlayForecastOn() ? forecastBars.length : 0;
  chart.timeScale().applyOptions({
    rightOffset: n ? n + 8 : 4
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

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapWhy(text, max = 24) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function boxesOverlap(a, b, pad = 4) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

function candleObstacle(x, yHigh, yLow, candleW) {
  if (x == null || yHigh == null || yLow == null) return null;
  const top = Math.min(yHigh, yLow);
  const bot = Math.max(yHigh, yLow);
  const padX = Math.max(5, candleW * 0.85);
  return {
    x: x - padX,
    y: top - 5,
    w: padX * 2,
    h: Math.max(bot - top, 8) + 10
  };
}

function envelopeForSpan(x, width, obstacles) {
  let top = Infinity;
  let bottom = -Infinity;
  const right = x + width;
  for (const o of obstacles) {
    if (o.x + o.w < x || o.x > right) continue;
    top = Math.min(top, o.y);
    bottom = Math.max(bottom, o.y + o.h);
  }
  return { top, bottom, hit: Number.isFinite(top) };
}

function hitsForbidden(box, obstacles, placed, pad = 8) {
  if (obstacles.some(o => boxesOverlap(box, o, pad))) return true;
  return placed.some(p => boxesOverlap(p, box, 6));
}

function placeCallout({ anchorX, anchorY, boxW, boxH, preferAbove, obstacles, placed, w, h }) {
  const gap = 12;
  const margin = 4;
  const floor = h - 22;
  const slides = [0, 28, -28, 56, -56, 84, -84, boxW * 0.7, -boxW * 0.7, boxW, -boxW, 180, 320, -180];
  const sides = preferAbove ? ['above', 'below'] : ['below', 'above'];
  const candidates = [];

  for (const side of sides) {
    for (const dx of slides) {
      const bx = Math.max(margin, Math.min(anchorX - boxW / 2 + dx, w - boxW - margin));
      const env = envelopeForSpan(bx, boxW, obstacles);
      const by = side === 'above'
        ? (env.hit ? env.top - gap : anchorY - 16) - boxH
        : (env.hit ? env.bottom + gap : anchorY + 16);
      if (by < margin || by + boxH > floor) continue;
      const box = { x: bx, y: by, w: boxW, h: boxH };
      if (hitsForbidden(box, obstacles, placed, 8)) continue;
      const tip = side === 'above' ? by + boxH : by;
      const dist = Math.abs(bx + boxW / 2 - anchorX) + Math.abs(tip - anchorY);
      candidates.push({ box, dist, side });
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0];
  }

  const parks = [
    { x: margin, y: margin },
    { x: Math.max(margin, w - boxW - margin), y: margin },
    { x: margin, y: floor - boxH },
    { x: Math.max(margin, w - boxW - margin), y: floor - boxH }
  ];
  for (const p of parks) {
    const box = { x: p.x, y: p.y, w: boxW, h: boxH };
    if (p.y < margin || p.y + boxH > floor) continue;
    if (!hitsForbidden(box, obstacles, placed, 8)) {
      return { box, dist: 999, side: p.y <= margin ? 'above' : 'below' };
    }
  }

  const global = envelopeForSpan(0, w, obstacles);
  const forcedY = global.hit ? global.top - gap - boxH : margin;
  const box = {
    x: Math.max(margin, Math.min(anchorX - boxW / 2, w - boxW - margin)),
    y: Math.min(Math.max(margin, forcedY), Math.max(margin, floor - boxH)),
    w: boxW,
    h: boxH
  };
  if (!hitsForbidden(box, obstacles, placed, 8)) return { box, dist: 9999, side: 'above' };
  box.y = margin;
  if (!hitsForbidden(box, obstacles, placed, 4)) return { box, dist: 9999, side: 'above' };
  return null;
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

  if (!chart || !candleSeries || w <= 0 || h <= 0) {
    svg.innerHTML = '';
    return;
  }
  const drawForecast = overlayForecastOn() && forecastBars.length;
  const drawNews = overlayNewsOn() && newsMarks.length;
  if (!drawForecast && !drawNews) {
    svg.innerHTML = '';
    return;
  }

  const ts = chart.timeScale();
  const lastX = lastBar ? ts.timeToCoordinate(lastBar.time) : null;
  const lastLogical = lastX != null ? ts.coordinateToLogical(lastX) : null;

  const spacing = chartBarSpacing();
  const candleW = Math.max(1, spacing * 0.8);
  const strokeW = spacing >= 8 ? 1.25 : spacing >= 4 ? 1 : 0.7;
  const fontPx = spacing >= 10 ? 10 : spacing >= 6 ? 9 : 0;
  const labelGap = Math.max(3, spacing * 0.4);
  const hasForecast = !!(drawForecast && lastBar && lastX != null && lastLogical != null);
  const dividerX = hasForecast ? lastX + spacing * 0.5 : null;
  const parts = [];

  const obstacles = [];
  for (const c of mappedCandles().candles || []) {
    const o = candleObstacle(
      ts.timeToCoordinate(c.time),
      candleSeries.priceToCoordinate(c.high),
      candleSeries.priceToCoordinate(c.low),
      candleW
    );
    if (o) obstacles.push(o);
  }

  if (hasForecast) {
    parts.push(
      `<line x1="${dividerX}" y1="8" x2="${dividerX}" y2="${h - 22}" stroke="rgba(139,148,158,0.35)" stroke-dasharray="3 3" stroke-width="1" />`
    );
    forecastBars.forEach((bar, i) => {
      const o = candleObstacle(
        ts.logicalToCoordinate(lastLogical + 1 + i),
        candleSeries.priceToCoordinate(bar.high),
        candleSeries.priceToCoordinate(bar.low),
        candleW
      );
      if (o) obstacles.push(o);
    });

    const pathPrices = [lastBar.close, ...forecastBars.flatMap(b => [b.high, b.low])].filter(n => n != null);
    const pathMin = Math.min(...pathPrices);
    const pathMax = Math.max(...pathPrices);
    const pathPad = Math.max((pathMax - pathMin) * 0.2, (lastBar.close || 1) * 0.01);
    const ySupport = forecastLevels.support != null
      && forecastLevels.support >= pathMin - pathPad
      && forecastLevels.support <= pathMax + pathPad
      ? candleSeries.priceToCoordinate(forecastLevels.support)
      : null;
    const yResist = forecastLevels.resistance != null
      && forecastLevels.resistance >= pathMin - pathPad
      && forecastLevels.resistance <= pathMax + pathPad
      ? candleSeries.priceToCoordinate(forecastLevels.resistance)
      : null;
    const guideEnd = Math.max(dividerX + 24, w - 10);

    const levelLabel = (text, y, color, below) => {
      const approxW = text.length * 5.6 + 8;
      const boxH = 12;
      const bx = Math.max(4, guideEnd - approxW);
      const rawY = below ? y + 4 : y - boxH - 2;
      const box = { x: bx, y: rawY, w: approxW, h: boxH };
      if (hitsForbidden(box, obstacles, [], 6)) {
        const env = envelopeForSpan(bx, approxW, obstacles);
        if (env.hit) {
          const up = env.top - 4 - boxH;
          const dn = env.bottom + 4;
          box.y = (up >= 4 && !hitsForbidden({ ...box, y: up }, obstacles, [], 6))
            ? up
            : Math.min(h - 26, dn);
        }
      }
      if (hitsForbidden(box, obstacles, [], 4)) return;
      parts.push(
        `<text x="${box.x + 2}" y="${box.y + 10}" fill="${color}" fill-opacity="0.75" font-size="9" font-family="JetBrains Mono, monospace">${escapeXml(text)}</text>`
      );
    };

    if (yResist != null && yResist >= 8 && yResist <= h - 22) {
      parts.push(
        `<line x1="${dividerX}" y1="${yResist}" x2="${guideEnd}" y2="${yResist}" stroke="#ff4d4d" stroke-opacity="0.28" stroke-dasharray="4 3" stroke-width="1" />`
      );
      levelLabel(
        t('chart.resistance', { price: formatPrice(forecastLevels.resistance, quote.value?.currency) }),
        yResist,
        '#ff4d4d',
        false
      );
    }
    if (ySupport != null && ySupport >= 8 && ySupport <= h - 22) {
      parts.push(
        `<line x1="${dividerX}" y1="${ySupport}" x2="${guideEnd}" y2="${ySupport}" stroke="#00d488" stroke-opacity="0.28" stroke-dasharray="4 3" stroke-width="1" />`
      );
      levelLabel(
        t('chart.support', { price: formatPrice(forecastLevels.support, quote.value?.currency) }),
        ySupport,
        '#00d488',
        true
      );
    }
  }

  if (hasForecast) {
    const turnDays = new Set(forecastTurns.filter(tr => tr.day > 0).map(tr => tr.day));
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
      if (fontPx && style && !turnDays.has(bar.day)) {
        parts.push(
          `<text x="${x}" y="${labelY}" fill="${style.color}" font-size="${fontPx}" font-family="JetBrains Mono, monospace" text-anchor="middle">${style.label}</text>`
        );
      }
    });
  }

  const placed = [];
  const newsSpacing = chartBarSpacing();
  if (drawNews) newsMarks.forEach((mark) => {
    const x = ts.timeToCoordinate(mark.time);
    const y = candleSeries.priceToCoordinate(mark.price);
    if (x == null || y == null) return;
    if (x < -10 || x > w + 10) return;
    const color = mark.dir > 0 ? '#00d488' : '#ff4d4d';
    const tag = mark.event || (mark.dir > 0 ? t('chart.pumpedTag') : t('chart.dumpedTag'));
    const why = mark.title && mark.title !== mark.event ? mark.title : '';
    const compact = newsSpacing < 11;
    const lines = compact
      ? [tag].filter(Boolean)
      : [...(tag ? [tag] : []), ...wrapWhy(why, 24)].filter(Boolean);
    const lineH = compact ? 10 : 11;
    const padX = compact ? 4 : 6;
    const padY = compact ? 3 : 4;
    const boxW = Math.min(compact ? 120 : 168, Math.max(56, ...lines.map(l => l.length * 6.15 + padX * 2)));
    const boxH = lines.length * lineH + padY * 2;
    const pipY = mark.dir > 0 ? y - 6 : y + 6;
    const pip = mark.dir > 0
      ? `<polygon points="${x},${y - 1} ${x + 3.6},${y - 8} ${x - 3.6},${y - 8}" fill="${color}" />`
      : `<polygon points="${x},${y + 1} ${x + 3.6},${y + 8} ${x - 3.6},${y + 8}" fill="${color}" />`;
    const href = (() => {
      try {
        const u = new URL(String(mark.url || '').trim());
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
      } catch { return ''; }
    })();
    const placedAt = lines.length ? placeCallout({
      anchorX: x,
      anchorY: pipY,
      boxW,
      boxH,
      preferAbove: mark.dir > 0,
      obstacles,
      placed,
      w,
      h
    }) : null;
    let body = pip;
    if (placedAt) {
      const box = placedAt.box;
      placed.push(box);
      obstacles.push({ ...box });
      const tipX = Math.max(box.x + 8, Math.min(x, box.x + box.w - 8));
      const tipY = (box.y + box.h <= y) ? box.y + box.h : box.y;
      body = [
        `<line x1="${x}" y1="${pipY}" x2="${tipX}" y2="${tipY}" stroke="${color}" stroke-opacity="0.45" stroke-width="1" />`,
        pip,
        `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="3" fill="rgba(13,17,23,0.92)" stroke="${color}" stroke-opacity="0.55" />`,
        ...lines.map((line, i) => (
          `<text x="${box.x + padX}" y="${box.y + padY + (i + 0.78) * lineH}" fill="${i === 0 ? color : '#c9d1d9'}" font-size="10" font-family="JetBrains Mono, monospace">${escapeXml(line)}</text>`
        ))
      ].join('');
    }
    parts.push(href
      ? `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer" style="pointer-events:auto">${body}</a>`
      : body
    );
  });
  if (hasForecast) forecastTurns.forEach((turn, idx) => {
    if (!turn.why) return;
    const x = turn.day <= 0
      ? lastX
      : ts.logicalToCoordinate(lastLogical + turn.day);
    const y = candleSeries.priceToCoordinate(turn.price);
    if (x == null || y == null) return;

    const color = turn.dir > 0 ? '#00d488' : turn.dir < 0 ? '#ff4d4d' : '#8b949e';
    const tag = turn.horizon && turn.horizon !== 'now'
      ? (HORIZON_STYLE[turn.horizon]?.label || turn.horizon)
      : (turn.kind === 'now' ? t('chart.now') : '');
    const lines = [...(tag ? [tag] : []), ...wrapWhy(turn.why, 26)];
    const lineH = 11;
    const padX = 6;
    const padY = 4;
    const boxW = Math.min(168, Math.max(72, ...lines.map(l => l.length * 6.15 + padX * 2)));
    const boxH = lines.length * lineH + padY * 2;
    const isPeak = turn.inDir > 0 && turn.outDir < 0;
    const isTrough = turn.inDir < 0 && turn.outDir > 0;
    const preferAbove = isPeak || (!isTrough && (turn.outDir > 0 || turn.dir >= 0 || idx % 2 === 0));
    const anchorX = turn.kind === 'now'
      ? Math.max(8, dividerX - boxW / 2 - 10)
      : x;

    const placedAt = placeCallout({
      anchorX,
      anchorY: y,
      boxW,
      boxH,
      preferAbove,
      obstacles,
      placed,
      w,
      h
    });
    if (!placedAt) return;

    const box = placedAt.box;
    placed.push(box);
    obstacles.push({ ...box });

    const tipX = Math.max(box.x + 8, Math.min(x, box.x + box.w - 8));
    const tipY = (box.y + box.h <= y) ? box.y + box.h : box.y;
    parts.push(
      `<line x1="${x}" y1="${y}" x2="${tipX}" y2="${tipY}" stroke="${color}" stroke-opacity="0.4" stroke-width="1" />`,
      `<circle cx="${x}" cy="${y}" r="3" fill="${color}" />`,
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="3" fill="rgba(13,17,23,0.92)" stroke="${color}" stroke-opacity="0.5" />`
    );
    lines.forEach((line, i) => {
      const fill = i === 0 && tag ? color : '#c9d1d9';
      parts.push(
        `<text x="${box.x + padX}" y="${box.y + padY + (i + 0.78) * lineH}" fill="${fill}" font-size="10" font-family="JetBrains Mono, monospace">${escapeXml(line)}</text>`
      );
    });
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
  const pred = predictionStore.currentPrediction;
  const { bars, turns } = buildForecastCandles(last, sorted, candles, pred);
  if (!bars.length) return;

  forecastBars = bars;
  forecastTurns = turns;
  forecastLevels = {
    support: pred?.indicators?.support ?? null,
    resistance: pred?.indicators?.resistance ?? null
  };
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

  markNowBar();
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
    newsMarks = [];
    clearPredictionOverlay();
    return;
  }
  chart.applyOptions({ timeScale: { timeVisible: !!isIntraday, secondsVisible: false } });
  candleSeries.setData(candles);
  volumeSeries.setData(volumes);
  lastBar = { ...candles[candles.length - 1] };
  rebuildNewsMarks(candles, isIntraday);
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

async function loadChartNews(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) {
    chartNewsArticles = [];
    return;
  }
  try {
    const res = await newsApi.stockHistory(sym, marketStore.selectedQuote?.name, 400);
    chartNewsArticles = res.data?.data || [];
  } catch {
    chartNewsArticles = [];
  }
  if (!chart || !candleSeries) return;
  const { candles, isIntraday } = mappedCandles();
  rebuildNewsMarks(candles, isIntraday);
  paintForecastOverlay();
}

watch(() => props.symbol, async (sym) => {
  if (!sym) return;
  loadGeneration++;
  clearAutoRetry();
  retryAttempt.value = 0;
  chartNewsArticles = [];
  newsStore.fetchStockNews(sym, marketStore.selectedQuote?.name);
  loadChartNews(sym);
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

watch(
  () => currentLocale(),
  () => {
    if (!chart || !candleSeries) return;
    const { candles, isIntraday } = mappedCandles();
    rebuildNewsMarks(candles, isIntraday);
    applyPredictionOverlay(candles);
    applyRightPad();
    paintForecastOverlay();
  }
);

watch(
  () => newsStore.stockArticles,
  () => {
    if (!chart || !candleSeries) return;
    const { candles, isIntraday } = mappedCandles();
    rebuildNewsMarks(candles, isIntraday);
    applyScaleForForecast(forecastBars);
    paintForecastOverlay();
  }
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
