<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0">
      <span class="label">Predictions — {{ symbol }}</span>
      <button
        @click="generate"
        :disabled="loading"
        class="text-xs px-3 py-1 rounded font-mono border transition-colors flex items-center gap-1.5"
        :class="loading ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
      >
        <span v-if="loading" class="animate-spin inline-block w-3 h-3 border border-accent border-t-transparent rounded-full"></span>
        {{ loading ? 'Analyzing...' : '⚡ Run Model' }}
      </button>
    </div>

    <div ref="scrollEl" class="panel-scroll flex-1 overflow-y-auto">
      <!-- Empty state -->
      <div v-if="!prediction && !loading" class="flex flex-col items-center justify-center h-20 text-gray-500 text-xs gap-1.5">
        <svg class="w-6 h-6 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l3 3"></path>
        </svg>
        <span>Click "Run Model" to generate predictions</span>
      </div>

      <div v-else-if="prediction">
        <!-- Trend banner -->
        <div class="px-2 pt-2 flex items-center gap-2 text-xs font-mono">
          <span class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold flex-shrink-0" :class="trendBadge">
            {{ prediction.trend?.label || '—' }}
          </span>
          <span v-if="prediction.newsSentiment?.buzz >= 1.8" class="text-[10px] text-gray-500">
            news {{ prediction.newsSentiment.buzz }}× normal
          </span>
        </div>

        <!-- Horizon predictions with price targets -->
        <div class="flex gap-1.5 p-2">
          <div
            v-for="p in prediction.predictions"
            :key="p.horizon"
            class="flex-1 card-sm p-2 text-center"
            :class="p.prediction === 'UP' ? 'border-bull/30' : p.prediction === 'DOWN' ? 'border-bear/30' : 'border-neutral/30'"
          >
            <div class="text-xs text-gray-500 font-mono mb-0.5">{{ p.horizon }}</div>
            <div class="text-base font-bold leading-none font-mono" :class="predColor(p.prediction)">
              {{ predIcon(p.prediction) }} {{ p.prediction }}
            </div>
            <div class="text-sm font-mono font-bold mt-1" :class="(p.expectedMovePct ?? 0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ (p.expectedMovePct ?? 0) >= 0 ? '+' : '' }}{{ (p.expectedMovePct ?? 0).toFixed(1) }}%
            </div>
            <div class="text-xs font-mono text-gray-300">→ ${{ (p.targetPrice ?? 0).toFixed(2) }}</div>
            <div v-if="p.low != null" class="text-[10px] font-mono text-gray-600 mt-0.5">${{ p.low.toFixed(0) }}–${{ p.high.toFixed(0) }}</div>
            <!-- Confidence bar -->
            <div class="mt-1.5 h-1 bg-surface-300 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-700"
                :class="p.prediction === 'UP' ? 'bg-bull' : p.prediction === 'DOWN' ? 'bg-bear' : 'bg-neutral'"
                :style="{ width: (p.confidence * 100) + '%' }"
              ></div>
            </div>
            <div class="text-[10px] font-mono text-gray-500 mt-0.5">{{ (p.confidence * 100).toFixed(0) }}% conf</div>
          </div>
        </div>

        <!-- Trade plan -->
        <div v-if="plan" class="mx-2 mb-2 card-sm p-2"
             :class="plan.direction === 'LONG' ? 'border-bull/30' : 'border-bear/30'">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-mono font-bold uppercase tracking-wide"
                  :class="plan.direction === 'LONG' ? 'text-bull' : 'text-bear'">
              📋 Trade Plan — {{ plan.direction }}
            </span>
            <span class="text-[10px] font-mono" :class="plan.rr >= 2 ? 'text-bull' : plan.rr >= 1.3 ? 'text-neutral' : 'text-bear'">
              R:R {{ plan.rr.toFixed(2) }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-1.5 text-center font-mono">
            <div>
              <div class="text-[10px] text-gray-500">ENTRY</div>
              <div class="text-xs font-bold text-gray-200">${{ plan.entry.toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500">STOP</div>
              <div class="text-xs font-bold text-bear">${{ plan.stop.toFixed(2) }}</div>
              <div class="text-[9px] text-gray-600 truncate" :title="plan.stopBasis">{{ plan.stopBasis }}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500">TARGET</div>
              <div class="text-xs font-bold text-bull">${{ plan.target.toFixed(2) }}</div>
              <div class="text-[9px] text-gray-600 truncate" :title="plan.targetBasis">{{ plan.targetBasis }}</div>
            </div>
          </div>
          <div class="mt-1.5 pt-1.5 border-t border-surface-300/50 flex items-center justify-between text-[10px] font-mono text-gray-500">
            <span>risk {{ plan.riskPct.toFixed(1) }}% / share</span>
            <span>size ≤{{ plan.positionPct }}% of account (1% risk rule)</span>
          </div>
        </div>

        <!-- Why: ranked reasons -->
        <div v-if="prediction.reasons?.length" class="px-2 pb-2">
          <div class="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1">Why</div>
          <div class="space-y-0.5">
            <div v-for="(r, i) in prediction.reasons" :key="i" class="text-xs text-gray-300 font-mono flex gap-1.5">
              <span class="text-gray-600">·</span><span>{{ r }}</span>
            </div>
          </div>
        </div>

        <!-- News events detected -->
        <div v-if="newsEvents.length || prediction.newsSentiment" class="px-2 pb-2">
          <div class="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1">
            News Impact
            <span v-if="prediction.newsSentiment" :class="newsColor" class="normal-case tracking-normal">
              — {{ prediction.newsSentiment.label }}
              <template v-if="prediction.newsSentiment.impactPct">
                ({{ prediction.newsSentiment.impactPct > 0 ? '+' : '' }}{{ prediction.newsSentiment.impactPct }}% implied)
              </template>
            </span>
          </div>
          <div v-if="newsEvents.length" class="flex flex-wrap gap-1">
            <span
              v-for="ev in newsEvents"
              :key="ev.id"
              class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              :class="ev.impact >= 0 ? 'bg-bull/10 text-bull border-bull/20' : 'bg-bear/10 text-bear border-bear/20'"
            >
              {{ ev.impact >= 0 ? '▲' : '▼' }} {{ ev.label }}{{ ev.count > 1 ? ' ×' + ev.count : '' }}
            </span>
          </div>
          <div v-else class="text-[10px] font-mono text-gray-600">no market-moving events detected in recent coverage</div>
        </div>

        <!-- Signal breakdown -->
        <div class="px-2 pb-2 border-t border-surface-300/50 pt-2">
          <div class="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1.5">Signal Breakdown</div>
          <div class="space-y-1">
            <div
              v-for="(signal, key) in displaySignals"
              :key="key"
              class="flex items-center gap-1.5 text-xs font-mono"
            >
              <div class="w-12 text-gray-500 text-right flex-shrink-0 text-xs">{{ shortKey(key) }}</div>
              <div class="flex-1 flex items-center h-3 relative">
                <div class="absolute left-1/2 w-px h-3 bg-surface-300"></div>
                <div
                  v-if="signal >= 0"
                  class="absolute bg-bull/60 rounded-r h-1.5 transition-all duration-500"
                  :style="{ left: '50%', width: Math.min(50, signal * 50) + '%' }"
                ></div>
                <div
                  v-else
                  class="absolute bg-bear/60 rounded-l h-1.5 transition-all duration-500"
                  :style="{ right: '50%', width: Math.min(50, Math.abs(signal) * 50) + '%' }"
                ></div>
              </div>
              <span class="w-10 text-right text-xs" :class="signal > 0 ? 'text-bull' : signal < 0 ? 'text-bear' : 'text-gray-500'">
                {{ signal > 0 ? '+' : '' }}{{ signal.toFixed(2) }}
              </span>
              <span class="w-7 text-right text-xs"
                    :class="(prediction.weights?.[key] ?? 0) < 0 ? 'text-neutral' : 'text-gray-600'"
                    :title="(prediction.weights?.[key] ?? 0) < 0 ? 'negative weight: model fades this signal' : ''">
                {{ prediction.weights?.[key] != null ? (prediction.weights[key] * 100).toFixed(0) + '%' : '' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Key levels -->
        <div v-if="prediction.indicators" class="px-2 pb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-gray-500">
          <span v-if="prediction.indicators.support">sup <span class="text-gray-300">${{ prediction.indicators.support }}</span></span>
          <span v-if="prediction.indicators.resistance">res <span class="text-gray-300">${{ prediction.indicators.resistance }}</span></span>
          <span v-if="prediction.indicators.adx">ADX <span class="text-gray-300">{{ prediction.indicators.adx }}</span></span>
          <span v-if="prediction.indicators.week52Position != null">52w <span class="text-gray-300">{{ (prediction.indicators.week52Position * 100).toFixed(0) }}%</span></span>
          <span class="ml-auto text-gray-600">Iter #{{ prediction.modelIteration }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { useMarketStore } from '../../stores/marketStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';

const marketStore = useMarketStore();
const predictionStore = usePredictionStore();

const symbol = computed(() => marketStore.selectedSymbol);
const prediction = computed(() => predictionStore.currentPrediction);
const loading = computed(() => predictionStore.generating);
const scrollEl = ref(null);

const plan = computed(() => prediction.value?.tradePlan || null);
const newsEvents = computed(() => prediction.value?.newsSentiment?.topEvents || []);

const newsColor = computed(() => {
  const l = prediction.value?.newsSentiment?.label;
  if (l === 'bullish') return 'text-bull';
  if (l === 'bearish') return 'text-bear';
  return 'text-gray-400';
});

const trendBadge = computed(() => {
  const d = prediction.value?.trend?.direction;
  if (d > 0) return 'bg-bull/20 text-bull';
  if (d < 0) return 'bg-bear/20 text-bear';
  return 'bg-neutral/20 text-neutral';
});

const displaySignals = computed(() => {
  const s = prediction.value?.signals;
  if (!s) return {};
  return Object.fromEntries(
    Object.entries(s)
      .filter(([, v]) => typeof v === 'number' && !isNaN(v))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  );
});

async function generate() {
  try {
    await predictionStore.generateForSymbol(symbol.value);
    await nextTick();
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
  } catch (e) {
    console.error('Prediction failed:', e);
  }
}

watch(prediction, async () => {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
});

function predColor(p) {
  if (p === 'UP') return 'text-bull';
  if (p === 'DOWN') return 'text-bear';
  return 'text-neutral';
}
function predIcon(p) {
  if (p === 'UP') return '↑';
  if (p === 'DOWN') return '↓';
  return '→';
}
function shortKey(key) {
  const map = {
    rsi: 'RSI', macd: 'MACD', sma_crossover: 'SMA-X', ema_crossover: 'EMA-X',
    bollinger: 'BB', volume_trend: 'Vol', news_sentiment: 'News',
    stochastic: 'Stoch', adx_trend: 'ADX', mfi: 'MFI', breakout: 'Brkout',
    momentum: 'Mom', trend_regime: 'Trend'
  };
  return map[key] || key;
}
</script>
