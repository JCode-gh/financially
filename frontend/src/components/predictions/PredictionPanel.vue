<template>
  <div class="card flex flex-col h-full overflow-hidden">
    <div class="flex items-center justify-between px-3 py-2.5 border-b border-surface-300 flex-shrink-0">
      <span class="label">{{ $t('setup.title', { symbol }) }}</span>
      <span v-if="prediction?.trend?.label" class="text-[10px] font-mono px-1.5 py-0.5 rounded" :class="trendBadge">
        {{ prediction.trend.label }}
      </span>
    </div>

    <div ref="scrollEl" class="panel-scroll flex-1 overflow-y-auto">
      <div v-if="!prediction && !loading" class="flex flex-col items-center justify-center h-24 text-gray-500 text-xs gap-1.5 px-4 text-center">
        {{ $t('setup.selectName') }}
      </div>

      <div v-else-if="prediction" class="p-3 space-y-3">
        <div class="grid grid-cols-3 gap-2">
          <div
            v-for="p in prediction.predictions"
            :key="p.horizon"
            class="card-sm px-2 py-2 text-center"
            :class="p.prediction === 'UP' ? 'border-bull/25' : p.prediction === 'DOWN' ? 'border-bear/25' : 'border-surface-300'"
          >
            <div class="text-[10px] text-gray-500 font-mono">{{ p.horizon }}</div>
            <div class="text-sm font-bold font-mono" :class="predColor(p.prediction)">{{ p.prediction }}</div>
            <div class="text-xs font-mono mt-0.5" :class="(p.expectedMovePct ?? 0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ (p.expectedMovePct ?? 0) >= 0 ? '+' : '' }}{{ (p.expectedMovePct ?? 0).toFixed(1) }}%
            </div>
          </div>
        </div>

        <div v-if="plan" class="card-sm p-3" :class="plan.direction === 'LONG' ? 'border-bull/30' : 'border-bear/30'">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-mono font-bold uppercase tracking-wide" :class="plan.direction === 'LONG' ? 'text-bull' : 'text-bear'">
              {{ plan.direction }}
            </span>
            <span class="text-[11px] font-mono" :class="plan.rr >= 2 ? 'text-bull' : plan.rr >= 1.3 ? 'text-neutral' : 'text-bear'">
              R:R {{ plan.rr.toFixed(2) }}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center font-mono">
            <div>
              <div class="text-[10px] text-gray-500">{{ $t('setup.entry') }}</div>
              <div class="text-sm font-bold text-gray-200">${{ plan.entry.toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500">{{ $t('setup.stop') }}</div>
              <div class="text-sm font-bold text-bear">${{ plan.stop.toFixed(2) }}</div>
            </div>
            <div>
              <div class="text-[10px] text-gray-500">{{ $t('setup.target') }}</div>
              <div class="text-sm font-bold text-bull">${{ plan.target.toFixed(2) }}</div>
            </div>
          </div>
        </div>

        <div v-if="newsEvents.length" class="flex flex-wrap gap-1">
          <span
            v-for="ev in newsEvents"
            :key="ev.id"
            class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
            :class="ev.impact >= 0 ? 'bg-bull/10 text-bull border-bull/20' : 'bg-bear/10 text-bear border-bear/20'"
          >
            {{ ev.label }}{{ ev.count > 1 ? ' ×' + ev.count : '' }}
          </span>
        </div>

        <div v-if="prediction.indicators" class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono text-gray-500">
          <span v-if="prediction.indicators.support">sup <span class="text-gray-300">${{ prediction.indicators.support }}</span></span>
          <span v-if="prediction.indicators.resistance">res <span class="text-gray-300">${{ prediction.indicators.resistance }}</span></span>
          <span v-if="prediction.indicators.adx">ADX <span class="text-gray-300">{{ prediction.indicators.adx }}</span></span>
          <span v-if="prediction.indicators.week52Position != null">52w <span class="text-gray-300">{{ (prediction.indicators.week52Position * 100).toFixed(0) }}%</span></span>
        </div>

        <button
          type="button"
          @click="showSignals = !showSignals"
          class="text-[11px] font-mono text-gray-500 hover:text-gray-300"
        >
          {{ showSignals ? $t('setup.hideSignals') : $t('setup.showSignals') }}
        </button>
        <div v-if="showSignals" class="space-y-1 pb-1">
          <div
            v-for="(signal, key) in displaySignals"
            :key="key"
            class="flex items-center gap-1.5 text-xs font-mono"
          >
            <div class="w-12 text-gray-500 text-right flex-shrink-0">{{ shortKey(key) }}</div>
            <div class="flex-1 flex items-center h-3 relative">
              <div class="absolute left-1/2 w-px h-3 bg-surface-300"></div>
              <div
                v-if="signal >= 0"
                class="absolute bg-bull/60 rounded-r h-1.5"
                :style="{ left: '50%', width: Math.min(50, signal * 50) + '%' }"
              ></div>
              <div
                v-else
                class="absolute bg-bear/60 rounded-l h-1.5"
                :style="{ right: '50%', width: Math.min(50, Math.abs(signal) * 50) + '%' }"
              ></div>
            </div>
            <span class="w-10 text-right" :class="signal > 0 ? 'text-bull' : signal < 0 ? 'text-bear' : 'text-gray-500'">
              {{ signal > 0 ? '+' : '' }}{{ signal.toFixed(2) }}
            </span>
          </div>
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
const showSignals = ref(false);

const plan = computed(() => prediction.value?.tradePlan || null);
const newsEvents = computed(() => prediction.value?.newsSentiment?.topEvents || []);

const trendBadge = computed(() => {
  const d = prediction.value?.trend?.direction;
  if (d > 0) return 'bg-bull/15 text-bull';
  if (d < 0) return 'bg-bear/15 text-bear';
  return 'bg-neutral/15 text-neutral';
});

const displaySignals = computed(() => {
  const s = prediction.value?.signals;
  if (!s) return {};
  return Object.fromEntries(
    Object.entries(s)
      .filter(([, v]) => typeof v === 'number' && !isNaN(v))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 8)
  );
});

watch(prediction, async () => {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
});

function predColor(p) {
  if (p === 'UP') return 'text-bull';
  if (p === 'DOWN') return 'text-bear';
  return 'text-neutral';
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
