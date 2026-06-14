<template>
  <div v-if="verdict" class="px-4 py-4 border-b border-surface-300 flex-shrink-0">
    <div class="flex items-start gap-4">
      <div
        class="flex-shrink-0 w-20 h-20 rounded-xl flex items-center justify-center text-2xl font-bold uppercase tracking-wide"
        :class="verdict.bg"
      >
        {{ verdict.label }}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-lg text-white leading-snug">{{ verdict.headline }}</p>
        <p v-if="verdict.detail" class="text-sm text-gray-400 mt-1">{{ verdict.detail }}</p>
        <div v-if="horizons.length" class="flex flex-wrap gap-3 mt-3 text-sm font-mono">
          <div v-for="h in horizons" :key="h.horizon" class="flex items-center gap-1.5">
            <span class="text-gray-500">{{ h.label }}:</span>
            <span :class="h.color">${{ h.price }}</span>
            <span :class="h.color">({{ h.move }})</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="loading" class="mt-2 text-xs text-gray-500 font-mono">Analyzing…</div>
  </div>
  <div v-else-if="loading" class="px-4 py-8 flex items-center justify-center gap-2 text-gray-500 text-sm">
    <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full"></div>
    <span>Getting recommendation…</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePredictionStore } from '../../stores/predictionStore.js';

const props = defineProps({
  symbol: String,
  loading: Boolean
});

const predictionStore = usePredictionStore();

const prediction = computed(() =>
  predictionStore.currentPrediction?.ticker === props.symbol?.toUpperCase()
    ? predictionStore.currentPrediction
    : null
);

function toAction(p) {
  if (p === 'UP') return 'buy';
  if (p === 'DOWN') return 'sell';
  return 'hold';
}

const verdict = computed(() => {
  const pred = prediction.value;
  if (!pred?.predictions?.length) return null;

  const fiveDay = pred.predictions.find(p => p.horizon === '5d') || pred.predictions[1];
  const action = pred.tradePlan?.direction === 'LONG' ? 'buy'
    : pred.tradePlan?.direction === 'SHORT' ? 'sell'
    : toAction(fiveDay?.prediction);

  const styles = {
    buy: { label: 'Buy', bg: 'bg-bull/15 text-bull border border-bull/30' },
    sell: { label: 'Sell', bg: 'bg-bear/15 text-bear border border-bear/30' },
    hold: { label: 'Hold', bg: 'bg-neutral/10 text-neutral border border-neutral/30' }
  };
  const s = styles[action];

  const headlines = {
    buy: `${props.symbol} leans up — the technical signals tilt bullish, but the edge is slight.`,
    sell: `${props.symbol} leans down — the technical signals tilt bearish, but the edge is slight.`,
    hold: `No clear edge right now — signals are mixed, so the honest call is to wait and watch ${props.symbol}.`
  };

  const detail = pred.reasons?.[0] || null;

  return {
    label: s.label,
    bg: s.bg,
    headline: headlines[action],
    detail
  };
});

const horizons = computed(() => {
  const preds = prediction.value?.predictions;
  if (!preds?.length) return [];

  const labels = { '1d': '1 day', '5d': '5 days', '30d': '30 days' };
  return preds.map(p => ({
    horizon: p.horizon,
    label: labels[p.horizon] || p.horizon,
    price: (p.targetPrice ?? 0).toFixed(2),
    move: `${(p.expectedMovePct ?? 0) >= 0 ? '+' : ''}${(p.expectedMovePct ?? 0).toFixed(1)}%`,
    color: p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral'
  }));
});
</script>
