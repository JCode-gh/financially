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

    <div ref="scrollEl" class="panel-scroll flex-1">
      <!-- Empty state -->
      <div v-if="!prediction && !loading" class="flex flex-col items-center justify-center h-20 text-gray-500 text-xs gap-1.5">
        <svg class="w-6 h-6 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle><path d="M12 8v4l3 3"></path>
        </svg>
        <span>Click "Run Model" to generate predictions</span>
      </div>

      <div v-else-if="prediction">
        <!-- Horizon predictions — compact row layout -->
        <div class="flex gap-1.5 p-2">
          <div
            v-for="p in prediction.predictions"
            :key="p.horizon"
            class="flex-1 card-sm p-2 text-center"
            :class="p.prediction === 'UP' ? 'border-bull/30' : p.prediction === 'DOWN' ? 'border-bear/30' : 'border-neutral/30'"
          >
            <div class="text-xs text-gray-500 font-mono mb-0.5">{{ p.horizon }}</div>
            <div class="text-xl font-bold leading-none" :class="predColor(p.prediction)">
              {{ predIcon(p.prediction) }}
            </div>
            <div class="text-xs font-mono font-semibold mt-0.5" :class="predColor(p.prediction)">
              {{ p.prediction }}
            </div>
            <!-- Confidence bar -->
            <div class="mt-1.5 h-1 bg-surface-300 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-700"
                :class="p.prediction === 'UP' ? 'bg-bull' : p.prediction === 'DOWN' ? 'bg-bear' : 'bg-neutral'"
                :style="{ width: (p.confidence * 100) + '%' }"
              ></div>
            </div>
            <div class="text-xs font-mono text-gray-500 mt-0.5">{{ (p.confidence * 100).toFixed(0) }}%</div>
          </div>
        </div>

        <!-- Score + sentiment row -->
        <div class="flex items-center gap-3 px-2 pb-2 text-xs font-mono">
          <div class="flex items-center gap-1">
            <span class="text-gray-500">Score</span>
            <span :class="(prediction.predictions[0]?.score||0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ ((prediction.predictions[0]?.score || 0) * 100).toFixed(1) }}
            </span>
          </div>
          <div v-if="prediction.newsSentiment" class="flex items-center gap-1">
            <span class="text-gray-500">News</span>
            <span :class="prediction.newsSentiment.label === 'bullish' ? 'text-bull' : prediction.newsSentiment.label === 'bearish' ? 'text-bear' : 'text-gray-400'">
              {{ prediction.newsSentiment.label }}
            </span>
          </div>
          <div class="ml-auto text-gray-600">Iter #{{ prediction.modelIteration }}</div>
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
              <!-- Weight -->
              <span class="w-7 text-right text-gray-600 text-xs">
                {{ prediction.weights?.[key] ? (prediction.weights[key] * 100).toFixed(0) + '%' : '' }}
              </span>
            </div>
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

const displaySignals = computed(() => {
  const s = prediction.value?.signals;
  if (!s) return {};
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => typeof v === 'number' && !isNaN(v))
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

// Scroll to top when prediction changes
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
  const map = { rsi: 'RSI', macd: 'MACD', sma_crossover: 'SMA-X', ema_crossover: 'EMA-X', bollinger: 'BB', volume_trend: 'Vol', news_sentiment: 'News' };
  return map[key] || key;
}
</script>
