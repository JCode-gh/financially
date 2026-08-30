<template>
  <Teleport to="body">
    <Transition name="trade-modal">
      <div v-if="visible" class="fixed inset-0 z-50 flex items-end justify-center">
        <div class="absolute inset-0 bg-black/60" @click="emit('close')" />

        <div class="relative w-full max-w-lg bg-surface rounded-t-2xl shadow-2xl border-t border-x border-surface-300 max-h-[88vh] flex flex-col" style="padding-bottom: env(safe-area-inset-bottom)">

          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-surface-300 flex-shrink-0">
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-white text-base">{{ symbol }}</span>
              <span class="text-gray-500 text-sm">· {{ $t('setup.tradeSetup') }}</span>
            </div>
            <button @click="emit('close')" class="text-gray-400 hover:text-white transition-colors p-1 -mr-1">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- Time picker -->
          <div class="px-4 pt-3 pb-2 flex-shrink-0">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">{{ $t('setup.maxHold') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in nearOptions"
                :key="opt.key"
                @click="selectTime(opt)"
                :class="timeClass(opt)"
              >
                {{ opt.label }}
              </button>
            </div>
            <p class="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2">{{ $t('setup.longerHold') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in yearOptions"
                :key="opt.key"
                @click="selectTime(opt)"
                :class="timeClass(opt)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- Scrollable content -->
          <div class="overflow-y-auto flex-1 px-4 pb-6">

            <!-- Loading -->
            <div v-if="loading" class="py-10 flex items-center justify-center gap-2 text-gray-500 text-sm">
              <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
              <span>{{ $t('setup.building') }}</span>
            </div>

            <!-- Error -->
            <div v-else-if="error" class="py-8 text-center text-sm text-gray-500">
              {{ error }}
            </div>

            <!-- No setup yet -->
            <div v-else-if="!setup" class="py-8 text-center text-xs text-gray-600">
              {{ $t('setup.pickTime') }}
            </div>

            <!-- NEUTRAL -->
            <div v-else-if="setup.direction === 'NEUTRAL'" class="py-8 text-center">
              <div class="text-4xl mb-3">–</div>
              <p class="text-gray-300 text-sm">{{ $t('setup.noSetup') }}</p>
              <p v-if="setup.reasons?.[0]" class="text-xs text-gray-500 mt-2 max-w-xs mx-auto">{{ setupReason(setup.reasons[0]) }}</p>
            </div>

            <!-- LONG / SHORT -->
            <template v-else>
              <!-- Direction + confidence -->
              <div class="flex items-center gap-3 mt-3 mb-4">
                <div
                  :class="[
                    'px-4 py-1.5 rounded-lg text-sm font-bold tracking-wider',
                    setup.direction === 'LONG'
                      ? 'bg-bull/15 text-bull border border-bull/30'
                      : 'bg-bear/15 text-bear border border-bear/30'
                  ]"
                >
                  {{ setup.direction === 'LONG' ? $t('setup.long') : $t('setup.short') }}
                </div>
                <span class="text-gray-400 text-sm font-mono">
                  {{ $t('setup.confidence', { n: (setup.confidence * 100).toFixed(0) }) }}
                </span>
                <span :class="['text-sm font-mono', setup.expectedMovePct >= 0 ? 'text-bull' : 'text-bear']">
                  {{ formatPct(setup.expectedMovePct, 1) }}
                </span>
              </div>

              <!-- Price levels -->
              <div class="grid grid-cols-3 gap-2 mb-3">
                <div class="bg-surface-200 rounded-xl p-3">
                  <div class="text-xs text-gray-500 mb-1">{{ $t('setup.entry') }}</div>
                  <div class="font-mono text-white font-bold text-sm">{{ formatPrice(setup.tradePlan.entry) }}</div>
                </div>
                <div class="bg-surface-200 rounded-xl p-3">
                  <div class="text-xs text-gray-500 mb-1">{{ $t('setup.stop') }}</div>
                  <div class="font-mono text-bear font-bold text-sm">{{ formatPrice(setup.tradePlan.stop) }}</div>
                  <div v-if="setup.tradePlan.stopBasis" class="text-xs text-gray-600 mt-0.5 truncate">{{ basisLabel(setup.tradePlan.stopBasis) }}</div>
                </div>
                <div class="bg-surface-200 rounded-xl p-3">
                  <div class="text-xs text-gray-500 mb-1">{{ $t('setup.target') }}</div>
                  <div class="font-mono text-bull font-bold text-sm">{{ formatPrice(setup.tradePlan.target) }}</div>
                  <div v-if="setup.tradePlan.targetBasis" class="text-xs text-gray-600 mt-0.5 truncate">{{ basisLabel(setup.tradePlan.targetBasis) }}</div>
                </div>
              </div>

              <!-- Risk metrics -->
              <div class="flex gap-5 mb-4 text-sm border border-surface-300 rounded-xl px-4 py-3">
                <div>
                  <div class="text-xs text-gray-500 mb-0.5">{{ $t('setup.riskReward') }}</div>
                  <div class="font-mono text-white">1 : {{ formatNumber(setup.tradePlan.rr, 1) }}</div>
                </div>
                <div class="w-px bg-surface-300 self-stretch" />
                <div>
                  <div class="text-xs text-gray-500 mb-0.5">{{ $t('setup.tradeRisk') }}</div>
                  <div class="font-mono text-white">{{ formatNumber(setup.tradePlan.riskPct, 2) }}%</div>
                </div>
                <div class="w-px bg-surface-300 self-stretch" />
                <div>
                  <div class="text-xs text-gray-500 mb-0.5">{{ $t('setup.positionSize') }}</div>
                  <div class="font-mono text-white">{{ $t('setup.ofPortfolio', { n: setup.tradePlan.positionPct }) }}</div>
                </div>
              </div>

              <!-- ATR info -->
              <div v-if="setup.atr" class="text-xs text-gray-600 mb-4 font-mono">
                {{ $t('setup.atrHold', { atr: formatNumber(setup.atr, 2), period: selected?.label || `${setup.maxDays}d`, hold: holdLabel }) }}
              </div>

              <!-- Reasons -->
              <div v-if="setup.reasons?.length" class="border-t border-surface-300 pt-3">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-2">{{ $t('setup.keySignals') }}</p>
                <ul class="space-y-1.5">
                  <li
                    v-for="r in setup.reasons.slice(0, 5)"
                    :key="r"
                    class="text-sm text-gray-300 flex gap-2 items-start"
                  >
                    <span class="text-gray-600 flex-shrink-0 mt-0.5">·</span>
                    {{ setupReason(r) }}
                  </li>
                </ul>
              </div>

              <!-- Honest edge disclaimer -->
              <div class="mt-4 flex gap-2 items-start text-xs text-gray-500 bg-surface-200/60 rounded-lg px-3 py-2.5 leading-relaxed">
                <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>
                  {{ $t('setup.disclaimer') }}
                </span>
              </div>
            </template>

          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { setupReason } from '../../utils/picks.js';
import { formatNumber, formatPct, formatPrice } from '../../utils/format.js';

const props = defineProps({
  visible: Boolean,
  symbol: String
});

const emit = defineEmits(['close']);

const predictionStore = usePredictionStore();
const { t } = useI18n();

const nearOptions = computed(() => [
  { key: '1d', days: 1, label: '1D' },
  { key: '3d', days: 3, label: '3D' },
  { key: '1w', days: 7, label: '1W' },
  { key: '2w', days: 14, label: '2W' },
  { key: '1m', days: 30, label: '1M' }
]);

const yearOptions = computed(() => [
  { key: '1y', days: 252, label: t('setup.times.y1') },
  { key: '2y', days: 504, label: t('setup.times.y2') },
  { key: '5y', days: 1260, label: t('setup.times.y5') }
]);

function timeClass(opt) {
  return [
    'px-3 py-1.5 rounded-lg text-sm font-mono border transition-colors',
    selected.value?.key === opt.key
      ? 'bg-accent/20 border-accent text-accent'
      : 'border-surface-300 text-gray-400 hover:border-gray-500 hover:text-gray-200'
  ];
}

const selected = ref(null);
const error = ref(null);

const setup = computed(() => predictionStore.tradeSetup);
const loading = computed(() => predictionStore.loading.tradeSetup);

const holdLabel = computed(() => {
  if (!selected.value) return '';
  const d = selected.value.days;
  if (d <= 2)   return t('setup.hold.short');
  if (d <= 5)   return t('setup.hold.swing');
  if (d <= 10)  return t('setup.hold.medium');
  if (d <= 20)  return t('setup.hold.position');
  if (d <= 70)  return t('setup.hold.trend');
  if (d <= 280) return t('setup.hold.year');
  return t('setup.hold.multi');
});

function basisLabel(raw) {
  const s = String(raw || '');
  if (/^atr$/i.test(s)) return t('setup.basis.atr');
  if (/^horizon$/i.test(s)) return t('setup.basis.horizon');
  const m = s.match(/^(support|resistance)\s+\$?([\d.]+)/i);
  if (!m) return s;
  return t(`setup.basis.${m[1].toLowerCase()}`, { price: formatPrice(m[2]) });
}

async function selectTime(opt) {
  selected.value = opt;
  error.value = null;
  try {
    await predictionStore.generateTradeSetup(props.symbol, opt.days);
  } catch (e) {
    error.value = e?.response?.data?.error || t('setup.failed');
  }
}

watch(() => props.visible, (v) => {
  if (!v) {
    selected.value = null;
    error.value = null;
    predictionStore.tradeSetup = null;
  }
});
</script>

<style scoped>
.trade-modal-enter-active,
.trade-modal-leave-active {
  transition: opacity 0.2s ease;
}
.trade-modal-enter-active .relative,
.trade-modal-leave-active .relative {
  transition: transform 0.25s ease;
}
.trade-modal-enter-from,
.trade-modal-leave-to {
  opacity: 0;
}
.trade-modal-enter-from .relative {
  transform: translateY(100%);
}
.trade-modal-leave-to .relative {
  transform: translateY(100%);
}
</style>
