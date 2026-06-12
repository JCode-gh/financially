<template>
  <div class="px-3 py-2">
    <div v-if="!accuracy" class="flex items-center justify-center h-12 text-gray-500 text-xs">
      Loading model metrics...
    </div>

    <template v-else>
      <!-- Horizon accuracy: live (resolved predictions) vs backtest (walk-forward) -->
      <div class="grid grid-cols-3 gap-2 mb-2">
        <div v-for="h in horizons" :key="h.id" class="card-sm p-2 text-center">
          <div class="text-xs text-gray-500 font-mono mb-0.5">{{ h.label }}</div>
          <div class="text-base font-bold font-mono leading-none" :class="accuracyColor(h.live)">
            {{ h.liveTotal > 0 ? (h.live * 100).toFixed(0) + '%' : '—' }}
          </div>
          <div class="text-[10px] text-gray-600 font-mono">live {{ h.liveCorrect }}/{{ h.liveTotal }}</div>
          <div class="mt-1 pt-1 border-t border-surface-300/50 text-[10px] font-mono flex items-center justify-center gap-1">
            <span class="text-gray-500">backtest</span>
            <span :class="accuracyColor(h.bt)">{{ h.btTotal > 0 ? (h.bt * 100).toFixed(1) + '%' : '—' }}</span>
          </div>
          <div class="text-[10px] text-gray-600 font-mono">{{ h.btTotal }} calls</div>
        </div>
      </div>

      <div class="flex items-center gap-2 text-[10px] font-mono text-gray-600 mb-2">
        <span>Iteration #{{ accuracy.modelIteration || 0 }}</span>
        <span v-if="trainedAt" class="ml-auto">trained {{ trainedAt }}</span>
      </div>

      <!-- Signed weight distribution -->
      <div class="text-xs text-gray-500 font-mono uppercase tracking-wider mb-1">Signal Weights (5d model)</div>
      <div class="text-[10px] text-gray-600 font-mono mb-1.5">negative = model fades this signal in the current regime</div>
      <div class="space-y-1">
        <div v-for="w in sortedWeights" :key="w.key" class="flex items-center gap-1.5 text-xs font-mono">
          <span class="text-gray-500 w-14 text-right truncate flex-shrink-0">{{ shortKey(w.key) }}</span>
          <div class="flex-1 flex items-center h-3 relative">
            <div class="absolute left-1/2 w-px h-3 bg-surface-300"></div>
            <div
              v-if="w.value >= 0"
              class="absolute bg-accent/60 rounded-r h-1.5"
              :style="{ left: '50%', width: Math.min(50, Math.abs(w.value) * 160) + '%' }"
            ></div>
            <div
              v-else
              class="absolute bg-neutral/70 rounded-l h-1.5"
              :style="{ right: '50%', width: Math.min(50, Math.abs(w.value) * 160) + '%' }"
            ></div>
          </div>
          <span class="w-9 text-right flex-shrink-0" :class="w.value >= 0 ? 'text-gray-300' : 'text-neutral'">
            {{ (w.value * 100).toFixed(0) }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePredictionStore } from '../../stores/predictionStore.js';

const predictionStore = usePredictionStore();
const accuracy = computed(() => predictionStore.accuracy);

const horizons = computed(() => {
  if (!accuracy.value?.horizons) return [];
  const btMap = {};
  for (const b of accuracy.value.backtest || []) btMap[b.horizon] = b;
  return accuracy.value.horizons.map(h => ({
    id: h.horizon,
    label: h.horizon === '1d' ? '1 Day' : h.horizon === '5d' ? '5 Days' : '30 Days',
    live: h.accuracy || 0,
    liveTotal: h.total || 0,
    liveCorrect: h.correct || 0,
    bt: btMap[h.horizon]?.accuracy || 0,
    btTotal: btMap[h.horizon]?.total || 0
  }));
});

const trainedAt = computed(() => {
  const t = accuracy.value?.backtest?.[0]?.trainedAt;
  if (!t) return null;
  const iso = String(t).includes('T') ? t : t.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
});

const sortedWeights = computed(() => {
  const w = accuracy.value?.modelWeights;
  if (!w) return [];
  return Object.entries(w)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
});

function accuracyColor(acc) {
  if (!acc) return 'text-gray-500';
  if (acc >= 0.58) return 'text-bull';
  if (acc >= 0.52) return 'text-bull/70';
  if (acc >= 0.48) return 'text-neutral';
  return 'text-bear';
}

function shortKey(key) {
  const map = {
    rsi: 'RSI', macd: 'MACD', sma_crossover: 'SMA-X',
    ema_crossover: 'EMA-X', bollinger: 'BB', volume_trend: 'Vol',
    news_sentiment: 'News', stochastic: 'Stoch', adx_trend: 'ADX',
    mfi: 'MFI', breakout: 'Brkout', momentum: 'Mom', trend_regime: 'Trend'
  };
  return map[key] || key;
}
</script>
