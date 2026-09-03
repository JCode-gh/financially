<template>
  <div v-if="verdict && variant === 'strip'" class="card px-3 py-2.5 sm:px-4 flex flex-wrap sm:flex-nowrap items-start gap-2 sm:gap-4">
    <div
      class="verdict-stamp flex-shrink-0 h-10 min-w-10 sm:h-12 sm:min-w-12 px-1.5 rounded-lg"
      :class="verdict.bg"
    >
      <span class="verdict-stamp-label text-[10px] sm:text-xs">{{ verdict.label }}</span>
    </div>
    <div class="flex-1 min-w-0 order-3 sm:order-none basis-full sm:basis-auto">
      <p class="text-sm text-white leading-snug">{{ verdict.headline }}</p>
      <div class="mt-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
        <p v-if="verdict.doNow" class="text-xs font-mono text-accent">{{ $t('verdict.doNow', { text: verdict.doNow }) }}</p>
        <p v-if="verdict.detail" class="text-[11px] font-mono text-gray-500 hidden md:block">{{ verdict.detail }}</p>
      </div>
      <p v-if="verdict.teaser" class="mt-1 text-[11px] font-mono text-gray-500 truncate" :title="verdict.teaser">
        {{ $t('brief.weighedShort') }} {{ verdict.teaser }}
      </p>
      <div v-if="verdict.canExpand" class="mt-1.5">
        <button
          type="button"
          class="text-[11px] font-mono text-accent hover:text-accent/70"
          @click="open = !open"
        >
          {{ open ? $t('verdict.hideDetails') : (ui.isSimple ? $t('verdict.whyCall') : $t('verdict.fullBreakdown')) }}
        </button>
        <div v-if="open" class="mt-2 space-y-2.5">
          <ul v-if="verdict.why.length" class="space-y-1">
            <li v-for="(w, i) in verdict.why" :key="i" class="text-sm text-gray-300 leading-relaxed">{{ w }}</li>
          </ul>
          <VerdictBriefing :briefing="verdict.briefing" :overlooked="verdict.overlooked" />
          <SourceList
            v-if="verdict.digest || verdict.sources.length"
            class="mt-2"
            :items="verdict.sources"
            :digest="verdict.digest"
            compact
          />
          <p v-if="verdict.risks.length" class="text-xs font-mono text-neutral">
            {{ $t('verdict.risk', { text: verdict.risks.join(' · ') }) }}
          </p>
        </div>
      </div>
    </div>
    <div v-if="ui.isPro && horizons.length" class="hidden lg:flex items-center gap-4 flex-shrink-0">
      <div v-for="h in horizons" :key="h.horizon" class="text-right">
        <div class="text-[10px] font-mono text-gray-500 uppercase">{{ h.label }}</div>
        <div class="text-sm font-mono font-semibold" :class="h.color">{{ h.move }}</div>
        <div class="text-[11px] font-mono text-gray-400">{{ h.price }}</div>
      </div>
    </div>
    <p v-if="ui.isPro && verdict.risks.length" class="hidden xl:block max-w-[240px] text-[11px] font-mono text-neutral leading-snug">
      {{ $t('verdict.risk', { text: verdict.risks[0] }) }}
    </p>
    <button
      type="button"
      @click="steerOpen = !steerOpen"
      :disabled="loading"
      class="flex-shrink-0 ml-auto sm:ml-0 text-[11px] sm:text-xs px-2.5 py-1.5 rounded font-mono border transition-colors"
      :class="loading ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
    >
      <span class="inline-flex items-center gap-1.5">
        {{ loading ? $t('verdict.readingShort') : (steerOpen ? $t('brief.hideSteer') : $t('brief.steer')) }}
        <span v-if="predictionStore.briefNotes && !steerOpen" class="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true"></span>
      </span>
    </button>
    <div v-if="steerOpen" class="order-4 basis-full pt-1 border-t border-surface-300">
      <VerdictSteer :symbol="symbol" :loading="loading" @applied="onSteered" />
    </div>
  </div>

  <div v-else-if="verdict" class="px-4 sm:px-5 py-3 sm:py-4 border-b border-surface-300 flex-shrink-0">
    <div class="flex items-start gap-3 sm:gap-4">
      <div
        class="verdict-stamp flex-shrink-0 h-14 min-w-14 sm:h-20 sm:min-w-20 px-2"
        :class="verdict.bg"
      >
        <span class="verdict-stamp-label text-xs sm:text-lg">{{ verdict.label }}</span>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-base sm:text-lg text-white leading-snug">{{ verdict.headline }}</p>
        <p v-if="verdict.doNow" class="text-sm font-mono text-accent mt-2">{{ $t('verdict.doNow', { text: verdict.doNow }) }}</p>
        <p v-if="verdict.detail" class="text-xs text-gray-400 mt-1">{{ verdict.detail }}</p>
        <ul v-if="verdict.why.length" class="mt-3 space-y-1">
          <li v-for="(w, i) in verdict.why" :key="i" class="text-sm text-gray-300" :class="ui.isPro ? 'font-mono' : 'leading-relaxed'">· {{ w }}</li>
        </ul>
        <p v-if="verdict.risks.length" class="mt-2 text-xs font-mono text-neutral">
          {{ $t('verdict.risk', { text: verdict.risks.join(' · ') }) }}
        </p>
        <div class="mt-3">
          <button
            type="button"
            class="text-[11px] font-mono text-accent hover:text-accent/70"
            @click="steerOpen = !steerOpen"
          >
            {{ steerOpen ? $t('brief.hideSteer') : $t('brief.steer') }}
          </button>
          <div v-if="steerOpen" class="mt-2">
            <VerdictSteer :symbol="symbol" :loading="loading" @applied="onSteered" />
          </div>
        </div>
        <VerdictBriefing class="mt-3" :briefing="verdict.briefing" :overlooked="verdict.overlooked" />
        <div v-if="ui.isPro && horizons.length" class="flex flex-wrap gap-4 mt-4 text-sm font-mono">
          <div v-for="h in horizons" :key="h.horizon" class="flex items-center gap-1.5">
            <span class="text-gray-500">{{ h.label }}:</span>
            <span :class="h.color">{{ h.price }}</span>
            <span :class="h.color">({{ h.move }})</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="loading" class="analyzing-card px-4 py-4 overflow-hidden border-b border-surface-300">
    <div class="flex items-center gap-3.5">
      <div class="analyzing-orb" aria-hidden="true">
        <span class="analyzing-ring"></span>
        <span class="analyzing-ring analyzing-ring--late"></span>
        <span class="analyzing-core"></span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm sm:text-base text-white font-medium tracking-tight">
          {{ $t('verdict.analyzingTitle', { symbol }) }}
        </p>
        <p :key="analyzeTick" class="mt-0.5 text-xs font-mono text-accent analyzing-step">{{ analyzingStep }}</p>
      </div>
    </div>
    <div class="mt-3.5 space-y-1.5" aria-hidden="true">
      <div class="analyzing-bar w-[92%]"></div>
      <div class="analyzing-bar analyzing-bar--slow w-[68%]"></div>
    </div>
  </div>
  <div v-else-if="predictionStore.error" class="px-4 py-3 text-xs font-mono text-bear border-b border-surface-300">
    {{ predictionStore.error }}
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import { formatPrice } from '../../utils/format.js';
import { simpleReasons } from '../../utils/picks.js';
import SourceList from '../news/SourceList.vue';
import VerdictSteer from './VerdictSteer.vue';
import VerdictBriefing from './VerdictBriefing.vue';

const open = ref(false);
const steerOpen = ref(false);
const analyzeTick = ref(0);
let analyzeTimer = null;

const props = defineProps({
  symbol: String,
  loading: Boolean,
  variant: { type: String, default: 'page' }
});

const predictionStore = usePredictionStore();
const ui = useUiStore();
const { t } = useI18n();

const analyzingSteps = computed(() => [
  t('verdict.analyzingTape'),
  t('verdict.analyzingNews'),
  t('verdict.analyzingWorld'),
  t('verdict.analyzingModel'),
  t('verdict.analyzingCall')
]);
const analyzingStep = computed(() => analyzingSteps.value[analyzeTick.value % analyzingSteps.value.length]);

function stopAnalyzeCycle() {
  clearInterval(analyzeTimer);
  analyzeTimer = null;
}

watch(() => props.loading, (on) => {
  stopAnalyzeCycle();
  if (!on) return;
  analyzeTick.value = 0;
  analyzeTimer = setInterval(() => { analyzeTick.value += 1; }, 1500);
}, { immediate: true });

onUnmounted(stopAnalyzeCycle);

const prediction = computed(() => {
  const key = props.symbol?.toUpperCase();
  const current = predictionStore.currentPrediction;
  if (current?.ticker === key) return current;
  return predictionStore.byTicker?.[key] || null;
});

function confidenceLabel(n) {
  if (n >= 70) return t('confidence.high');
  if (n >= 50) return t('confidence.medium');
  return t('confidence.low');
}

function toAction(p) {
  if (p === 'UP' || p === 'BUY' || p === 'LONG') return 'buy';
  if (p === 'DOWN' || p === 'SELL' || p === 'SHORT') return 'sell';
  return 'hold';
}

const verdict = computed(() => {
  const pred = prediction.value;
  if (!pred?.predictions?.length) return null;

  const ai = pred.ai;
  const fiveDay = pred.predictions.find(p => p.horizon === '5d') || pred.predictions[1];
  const action = ai?.action
    ? toAction(ai.action)
    : pred.tradePlan?.direction === 'LONG' ? 'buy'
      : pred.tradePlan?.direction === 'SHORT' ? 'sell'
      : toAction(fiveDay?.prediction);

  const styles = {
    buy: { label: t('action.buy'), bg: 'bg-bull/15 text-bull border border-bull/30' },
    sell: { label: t('action.sell'), bg: 'bg-bear/15 text-bear border border-bear/30' },
    hold: { label: t('action.hold'), bg: 'bg-neutral/10 text-neutral border border-neutral/30' }
  };
  const s = styles[action];

  const fallback = {
    buy: t('verdict.fallbackBuy', { symbol: props.symbol }),
    sell: t('verdict.fallbackSell', { symbol: props.symbol }),
    hold: t('verdict.fallbackHold', { symbol: props.symbol })
  };

  const newsN = pred.newsUsed ?? pred.newsSentiment?.articleCount;
  const headline = ai?.thesis || fallback[action];
  const rawWhy = ui.isSimple
    ? (ai?.why?.length ? ai.why : simpleReasons(pred.reasons || []))
    : (ai?.why || pred.reasons?.slice(0, 5) || []);
  const why = ui.isSimple
    ? rawWhy.filter(w => !/\b(macd|adx|rsi|sma|ema|stochastic|bollinger)\b/i.test(w))
    : rawWhy;
  const risks = ai?.risks || [];

  return {
    label: s.label,
    bg: s.bg,
    headline,
    doNow: ai?.doNow || '',
    detail: ui.isSimple
      ? (ai ? t('confidence.label', { level: confidenceLabel(ai.conviction) }) : null)
      : (ai
        ? `${t('verdict.llamaMeta', { pct: ai.conviction })}${ai.disagreement === 'news_vs_tech' ? ` · ${t('verdict.newsVsTape')}` : ''}${newsN != null ? ` · ${t('verdict.headlines', { n: newsN })}` : ''}`
        : (pred.aiError ? t('verdict.llamaOffline', { reason: pred.reasons?.[0] || t('verdict.quantOnly') }) : pred.reasons?.[0] || null)),
    why,
    risks,
    sources: (pred.sources || []).filter(s => s?.title && s?.url).slice(0, 5),
    digest: String(pred.sourcesDigest || '').trim(),
    briefing: pred.briefing || null,
    overlooked: pred.overlooked || pred.ai?.overlooked || [],
    teaser: (pred.briefing?.considered || []).slice(0, 4).map(c => c.value).filter(Boolean).join(' · '),
    canExpand: !!(headline || why.length || risks.length || pred.sourcesDigest || pred.briefing || pred.overlooked?.length)
  };
});

watch(() => props.symbol, () => { open.value = false; steerOpen.value = false; });

function onSteered() {
  open.value = true;
  steerOpen.value = false;
}

const horizons = computed(() => {
  const preds = prediction.value?.predictions;
  if (!preds?.length) return [];
  const labels = { '1d': '1d', '5d': '5d', '30d': '30d' };
  return preds.map(p => ({
    horizon: p.horizon,
    label: labels[p.horizon] || p.horizon,
    price: formatPrice(p.targetPrice),
    move: `${(p.expectedMovePct ?? 0) >= 0 ? '+' : ''}${(p.expectedMovePct ?? 0).toFixed(1)}%`,
    color: p.prediction === 'UP' ? 'text-bull' : p.prediction === 'DOWN' ? 'text-bear' : 'text-neutral'
  }));
});

</script>

<style scoped>
.verdict-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.verdict-stamp-label {
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}

.analyzing-card {
  position: relative;
}
.analyzing-card::after {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #00d4ff, transparent);
  animation: analyzingScan 2.2s ease-in-out infinite;
}
.analyzing-orb {
  position: relative;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
}
.analyzing-core {
  position: absolute;
  inset: 30%;
  border-radius: 999px;
  background: #00d4ff;
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.7);
  animation: analyzingPulse 1.4s ease-in-out infinite;
}
.analyzing-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1.5px solid rgba(0, 212, 255, 0.55);
  animation: analyzingRipple 2s ease-out infinite;
}
.analyzing-ring--late {
  animation-delay: 1s;
}
.analyzing-step {
  animation: analyzingIn 0.35s ease-out;
}
.analyzing-bar {
  height: 7px;
  border-radius: 0;
  background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(0,212,255,0.22), rgba(255,255,255,0.04));
  background-size: 200% 100%;
  animation: analyzingShimmer 1.6s ease-in-out infinite;
}
.analyzing-bar--slow {
  animation-duration: 2.1s;
}
@keyframes analyzingScan {
  0% { transform: translateX(-100%); opacity: 0; }
  20% { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
}
@keyframes analyzingPulse {
  0%, 100% { transform: scale(0.85); opacity: 0.7; }
  50% { transform: scale(1.1); opacity: 1; }
}
@keyframes analyzingRipple {
  0% { transform: scale(0.55); opacity: 0.7; }
  100% { transform: scale(1.15); opacity: 0; }
}
@keyframes analyzingIn {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
@keyframes analyzingShimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
</style>
