<template>
  <footer class="hidden lg:flex h-7 flex-shrink-0 bg-surface-100 border-t border-surface-300 px-3 items-center gap-3 text-[10px] font-mono text-gray-500">
    <span class="flex items-center gap-1.5">
      <span :class="ui.backendDown ? 'idle-dot' : 'live-dot'"></span>
      <span :class="ui.backendDown ? 'text-bear' : 'text-gray-400'">{{ ui.backendDown ? $t('status.apiDown') : $t('status.api') }}</span>
    </span>
    <span class="text-surface-300">|</span>
    <span :class="market.liveConnected ? 'text-bull' : 'text-gray-600'">
      {{ market.liveConnected ? $t('status.live') : $t('status.idle') }}
    </span>
    <span class="text-surface-300">|</span>
    <span :class="session.open ? 'text-bull' : 'text-gray-500'">{{ $t('status.us', { session: session.label }) }}</span>
    <span class="text-surface-300">|</span>
    <span :class="ollamaOk ? 'text-accent' : 'text-gray-600'">{{ ollamaLabel }}</span>
    <span v-if="market.lastUpdated" class="hidden sm:inline text-gray-600">
      {{ $t('status.quotes', { ago: timeAgo(market.lastUpdated) }) }}
    </span>
    <span v-if="ui.isPro && prediction.accuracy?.modelIteration" class="hidden md:inline ml-auto text-gray-600">
      {{ $t('status.modelIter', { n: prediction.accuracy.modelIteration }) }}
    </span>
    <span class="ml-auto md:ml-0 text-gray-600">{{ clock }}</span>
  </footer>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMarketStore } from '../../stores/marketStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { timeAgo, formatClock } from '../../utils/format.js';
import { usSession } from '../../utils/marketHours.js';

const { t } = useI18n();
const market = useMarketStore();
const prediction = usePredictionStore();
const ui = useUiStore();
const clock = ref(formatClock());
const session = ref(usSession());
const ollamaOk = computed(() => !!ui.health?.ollama?.ok);
const ollamaLabel = computed(() => {
  if (!ollamaOk.value) return t('status.llamaOff');
  const name = String(ui.health?.ollama?.model || '').replace(/:latest$/i, '');
  return name || t('status.llama');
});
let timer;

onMounted(() => {
  timer = setInterval(() => {
    clock.value = formatClock();
    session.value = usSession();
  }, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>
