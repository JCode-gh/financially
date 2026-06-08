<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between px-3 py-2 border-b border-surface-300">
      <span class="label">Model Accuracy — Self-Learning</span>
      <span class="text-xs font-mono text-gray-500">Iter #{{ accuracy?.modelIteration || 0 }}</span>
    </div>

    <div v-if="!accuracy" class="flex items-center justify-center h-12 text-gray-500 text-xs">
      Loading accuracy metrics...
    </div>

    <div v-else class="flex items-stretch divide-x divide-surface-300">
      <!-- Horizon accuracy blocks -->
      <div
        v-for="h in horizons"
        :key="h.id"
        class="flex-1 px-3 py-2 text-center"
      >
        <div class="text-xs text-gray-500 font-mono mb-1">{{ h.label }}</div>
        <div class="text-lg font-bold font-mono" :class="accuracyColor(h.accuracy)">
          {{ h.total > 0 ? (h.accuracy * 100).toFixed(1) + '%' : '—' }}
        </div>
        <div class="text-xs text-gray-600 font-mono">{{ h.correct }}/{{ h.total }}</div>
        <!-- Mini accuracy bar -->
        <div class="mt-1 h-1 bg-surface-300 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-700"
            :class="accuracyBarColor(h.accuracy)"
            :style="{ width: (h.accuracy * 100) + '%' }"
          ></div>
        </div>
      </div>

      <!-- Divider -->
      <div class="flex-shrink-0 w-px bg-surface-300"></div>

      <!-- Top indicators -->
      <div class="px-3 py-2 min-w-0 flex-1">
        <div class="text-xs text-gray-500 font-mono mb-1.5">Top Indicators</div>
        <div class="space-y-0.5">
          <div
            v-for="ind in topIndicators"
            :key="ind.name"
            class="flex items-center gap-2 text-xs font-mono"
          >
            <span class="text-gray-400 w-16 truncate">{{ ind.name }}</span>
            <div class="flex-1 h-1 bg-surface-300 rounded-full overflow-hidden">
              <div
                class="h-full transition-all"
                :class="ind.accuracy >= 60 ? 'bg-bull/60' : ind.accuracy >= 50 ? 'bg-neutral/60' : 'bg-bear/60'"
                :style="{ width: ind.accuracy + '%' }"
              ></div>
            </div>
            <span :class="ind.accuracy >= 60 ? 'text-bull' : ind.accuracy >= 50 ? 'text-neutral' : 'text-bear'">
              {{ ind.accuracy.toFixed(0) }}%
            </span>
          </div>
        </div>
      </div>

      <!-- Model weights chart -->
      <div class="px-3 py-2 min-w-0 flex-1 hidden lg:block">
        <div class="text-xs text-gray-500 font-mono mb-1.5">Weight Distribution</div>
        <div class="space-y-0.5">
          <div v-for="(w, key) in accuracy.modelWeights" :key="key" class="flex items-center gap-1.5 text-xs font-mono">
            <span class="text-gray-500 w-12 text-right truncate">{{ shortKey(key) }}</span>
            <div class="flex-1 h-1.5 bg-surface-300 rounded-full overflow-hidden">
              <div class="h-full bg-accent/50 transition-all" :style="{ width: (w * 100) + '%' }"></div>
            </div>
            <span class="text-gray-400 w-6 text-right">{{ (w * 100).toFixed(0) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePredictionStore } from '../../stores/predictionStore.js';

const predictionStore = usePredictionStore();
const accuracy = computed(() => predictionStore.accuracy);

const horizons = computed(() => {
  if (!accuracy.value?.horizons) return [];
  return accuracy.value.horizons.map(h => ({
    id: h.horizon,
    label: h.horizon === '1d' ? '1 Day' : h.horizon === '5d' ? '5 Days' : '30 Days',
    accuracy: h.accuracy || 0,
    total: h.total || 0,
    correct: h.correct || 0
  }));
});

const topIndicators = computed(() => {
  const stats = accuracy.value?.indicatorStats;
  if (!stats) return [];
  return Object.entries(stats)
    .filter(([, v]) => v.total >= 3)
    .map(([k, v]) => ({
      name: shortKey(k),
      accuracy: v.accuracy || 0,
      total: v.total
    }))
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);
});

function accuracyColor(acc) {
  if (acc === 0) return 'text-gray-500';
  if (acc >= 0.65) return 'text-bull glow-bull';
  if (acc >= 0.55) return 'text-bull/70';
  if (acc >= 0.45) return 'text-neutral';
  return 'text-bear';
}

function accuracyBarColor(acc) {
  if (acc >= 0.65) return 'bg-bull';
  if (acc >= 0.55) return 'bg-bull/60';
  if (acc >= 0.45) return 'bg-neutral';
  return 'bg-bear';
}

function shortKey(key) {
  const map = {
    rsi: 'RSI', macd: 'MACD', sma_crossover: 'SMA-X',
    ema_crossover: 'EMA-X', bollinger: 'BB', volume_trend: 'Vol',
    news_sentiment: 'News'
  };
  return map[key] || key;
}
</script>
