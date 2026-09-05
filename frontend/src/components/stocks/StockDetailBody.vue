<template>
  <div v-if="quote || verdict || symbol" class="divide-y divide-surface-300">
    <section v-if="verdict" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.call') }}</p>
      <div class="flex items-start gap-4 sm:gap-5">
        <div
          class="verdict-stamp flex-shrink-0 h-16 min-w-16 sm:h-20 sm:min-w-20 px-2"
          :class="verdict.bg"
        >
          <span class="verdict-stamp-label text-sm sm:text-lg">{{ verdict.label }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-lg sm:text-xl text-white leading-snug">{{ verdict.headline }}</p>
          <p v-if="verdict.doNow" class="mt-3 text-sm font-mono text-accent">
            {{ $t('verdict.doNow', { text: verdict.doNow }) }}
          </p>
          <div v-if="verdict.chips.length" class="mt-3 flex flex-wrap gap-2">
            <span
              v-for="chip in verdict.chips"
              :key="chip"
              class="text-[11px] font-mono px-2 py-1 rounded border border-surface-300 text-gray-400"
            >{{ chip }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="detail-section detail-section--flush">
      <div class="px-4 sm:px-6 lg:px-8 pt-6 pb-2">
        <p class="detail-kicker !mb-0">{{ $t('detail.chart') }}</p>
      </div>
      <div class="h-[600px] sm:h-[720px] lg:h-[800px] overflow-hidden">
        <StockChart :symbol="symbol" hide-quote flush />
      </div>
    </section>

    <section v-if="verdict?.why?.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.why') }}</p>
      <ul class="space-y-3">
        <li
          v-for="(w, i) in verdict.why"
          :key="i"
          class="text-[15px] text-gray-200 leading-relaxed pl-3 border-l-2 border-surface-300"
        >{{ w }}</li>
      </ul>
    </section>

    <section v-if="verdict?.risks?.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.risks') }}</p>
      <ul class="space-y-3">
        <li
          v-for="(r, i) in verdict.risks"
          :key="i"
          class="text-sm font-mono text-neutral leading-relaxed pl-3 border-l-2 border-neutral/30"
        >{{ r }}</li>
      </ul>
    </section>

    <section v-if="horizons.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.forecast') }}</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          v-for="h in horizons"
          :key="h.horizon"
          class="card-sm px-4 py-4"
          :class="h.border"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-mono text-gray-500 uppercase tracking-wide">{{ h.label }}</span>
            <span v-if="ui.isPro && h.prediction" class="text-[11px] font-mono font-semibold" :class="h.color">
              {{ h.prediction }}
            </span>
          </div>
          <div class="mt-2 text-2xl font-mono font-semibold" :class="h.color">{{ h.move }}</div>
          <div class="mt-1 text-sm font-mono text-gray-300">{{ h.price }}</div>
          <div v-if="ui.isPro && h.low && h.high" class="mt-2 text-[11px] font-mono text-gray-500">
            {{ $t('detail.range') }} {{ h.low }} – {{ h.high }}
          </div>
          <div v-if="ui.isPro && h.confidence != null" class="mt-1 text-[11px] font-mono text-gray-600">
            {{ $t('setup.confidence', { n: h.confidence }) }}
          </div>
        </div>
      </div>
    </section>

    <section v-if="ui.isPro && plan" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.levels') }}</p>
      <div class="flex items-center gap-3 mb-4">
        <span
          class="text-xs font-mono font-bold uppercase tracking-wide"
          :class="plan.direction === 'LONG' ? 'text-bull' : 'text-bear'"
        >{{ plan.direction === 'LONG' ? $t('setup.long') : $t('setup.short') }}</span>
        <span
          v-if="plan.rr != null"
          class="text-xs font-mono"
          :class="plan.rr >= 2 ? 'text-bull' : plan.rr >= 1.3 ? 'text-neutral' : 'text-bear'"
        >R:R {{ formatNumber(plan.rr, 2) }}</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ $t('setup.entry') }}</div>
          <div class="mt-1 text-base font-mono font-semibold text-gray-100">{{ formatPrice(plan.entry, currency) }}</div>
        </div>
        <div class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ $t('setup.stop') }}</div>
          <div class="mt-1 text-base font-mono font-semibold text-bear">{{ formatPrice(plan.stop, currency) }}</div>
        </div>
        <div class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ $t('setup.target') }}</div>
          <div class="mt-1 text-base font-mono font-semibold text-bull">{{ formatPrice(plan.target, currency) }}</div>
        </div>
        <div v-if="indicators?.support != null || indicators?.resistance != null" class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ $t('detail.support') }} / {{ $t('detail.resistance') }}</div>
          <div class="mt-1 text-sm font-mono text-gray-200">
            {{ formatPrice(indicators?.support, currency) }}
            <span class="text-gray-600"> / </span>
            {{ formatPrice(indicators?.resistance, currency) }}
          </div>
        </div>
      </div>
    </section>

    <section v-if="quoteStats.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.quote') }}</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div v-for="stat in quoteStats" :key="stat.key" class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ stat.label }}</div>
          <div class="mt-1 text-sm font-mono text-gray-100">{{ stat.value }}</div>
        </div>
      </div>
      <div v-if="week52Pct != null" class="mt-5">
        <div class="flex items-center justify-between text-[11px] font-mono text-gray-500 mb-2">
          <span>{{ $t('detail.week52Range') }}</span>
          <span>{{ Math.round(week52Pct) }}%</span>
        </div>
        <div class="relative h-1.5 rounded-full bg-surface-300">
          <div
            class="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-accent border border-surface"
            :style="{ left: `clamp(0%, ${week52Pct}%, 100%)`, transform: 'translate(-50%, -50%)' }"
          />
        </div>
        <div class="mt-2 flex justify-between text-[11px] font-mono text-gray-600">
          <span>{{ formatPrice(quote.week52Low, currency) }}</span>
          <span>{{ formatPrice(quote.week52High, currency) }}</span>
        </div>
      </div>
    </section>

    <section v-if="ui.isPro && tapeStats.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.tape') }}</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div v-for="stat in tapeStats" :key="stat.key" class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ stat.label }}</div>
          <div class="mt-1 text-sm font-mono text-gray-100">{{ stat.value }}</div>
        </div>
      </div>
      <div v-if="displaySignals.length" class="mt-6">
        <p class="text-[11px] font-mono text-gray-500 uppercase tracking-wider mb-3">{{ $t('detail.signals') }}</p>
        <div class="space-y-2.5">
          <div
            v-for="row in displaySignals"
            :key="row.key"
            class="flex items-center gap-2 text-xs font-mono"
          >
            <div class="w-14 text-gray-500 text-right flex-shrink-0">{{ row.label }}</div>
            <div class="flex-1 flex items-center h-3 relative">
              <div class="absolute left-1/2 w-px h-3 bg-surface-300"></div>
              <div
                v-if="row.value >= 0"
                class="absolute bg-bull/60 rounded-r h-1.5"
                :style="{ left: '50%', width: Math.min(50, row.value * 50) + '%' }"
              ></div>
              <div
                v-else
                class="absolute bg-bear/60 rounded-l h-1.5"
                :style="{ right: '50%', width: Math.min(50, Math.abs(row.value) * 50) + '%' }"
              ></div>
            </div>
            <span class="w-12 text-right" :class="row.value > 0 ? 'text-bull' : row.value < 0 ? 'text-bear' : 'text-gray-500'">
              {{ row.value > 0 ? '+' : '' }}{{ row.value.toFixed(2) }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <section v-if="notesReply" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.notesApplied') }}</p>
      <p class="text-[15px] text-gray-200 leading-relaxed">{{ notesReply }}</p>
      <p v-if="claimCheckLabel" class="mt-2 text-[11px] font-mono" :class="claimCheckClass">{{ claimCheckLabel }}</p>
      <p v-if="notesImpactLabel" class="mt-1 text-[11px] font-mono text-gray-500">{{ notesImpactLabel }}</p>
    </section>

    <section v-if="overlooked.length" class="detail-section">
      <p class="detail-kicker text-accent">{{ $t('brief.overlooked') }}</p>
      <ul class="space-y-3">
        <li
          v-for="(line, i) in overlooked"
          :key="i"
          class="text-[15px] text-gray-200 leading-relaxed pl-3 border-l-2 border-accent/40"
        >{{ line }}</li>
      </ul>
    </section>

    <section v-if="newsEvents.length" class="detail-section">
      <p class="detail-kicker">{{ $t('detail.events') }}</p>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="ev in newsEvents"
          :key="ev.id || ev.label"
          class="text-xs font-mono px-2.5 py-1.5 rounded border"
          :class="ev.impact >= 0 ? 'bg-bull/10 text-bull border-bull/20' : 'bg-bear/10 text-bear border-bear/20'"
        >
          {{ eventLabel(ev) }}<span v-if="ev.count > 1"> ×{{ ev.count }}</span>
        </span>
      </div>
    </section>

    <section v-if="headlines.length" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.headlinesUsed') }}</p>
      <ul class="space-y-4">
        <li v-for="(h, i) in headlines" :key="h.url || i">
          <a
            v-if="hrefOf(h.url)"
            :href="hrefOf(h.url)"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-accent hover:underline underline-offset-2 leading-snug"
          >{{ h.title }}</a>
          <p v-else class="text-sm text-gray-200 leading-snug">{{ h.title }}</p>
          <p v-if="h.source" class="mt-1 text-[11px] font-mono text-gray-600">{{ h.source }}</p>
        </li>
      </ul>
    </section>

    <section v-if="world.length" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.worldHits') }}</p>
      <ul class="space-y-5">
        <li v-for="w in world" :key="w.url || w.title">
          <a
            v-if="hrefOf(w.url)"
            :href="hrefOf(w.url)"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-accent hover:underline underline-offset-2"
          >{{ w.title }}</a>
          <p v-else class="text-sm text-gray-200">{{ w.title }}</p>
          <p v-if="w.summary" class="mt-1.5 text-sm text-gray-400 leading-relaxed">{{ w.summary }}</p>
        </li>
      </ul>
    </section>

    <section v-if="considered.length" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.considered') }}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div v-for="item in considered" :key="item.id" class="card-sm px-3 py-3">
          <div class="text-[11px] font-mono text-gray-500">{{ item.label }}</div>
          <div class="mt-1 text-sm text-gray-200 leading-snug">{{ item.value }}</div>
        </div>
      </div>
    </section>

    <section v-if="verdict?.digest || verdict?.sources?.length" class="detail-section">
      <p class="detail-kicker">{{ $t('verdict.sources') }}</p>
      <SourceList :items="verdict.sources" :digest="verdict.digest" />
    </section>

    <section v-if="ui.isPro && skipped.length" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.skipped') }}</p>
      <ul class="space-y-2.5">
        <li v-for="item in skipped" :key="item.id" class="text-sm text-gray-500 leading-snug">
          <span class="text-gray-400">{{ item.label }}</span>
          <span class="text-gray-600"> — {{ item.why }}</span>
        </li>
      </ul>
    </section>

    <section v-if="verdict" class="detail-section">
      <p class="detail-kicker">{{ $t('brief.steer') }}</p>
      <VerdictSteer :symbol="symbol" :loading="loading" />
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUiStore } from '../../stores/uiStore.js';
import { formatCompact, formatNumber, formatPrice } from '../../utils/format.js';
import { useDeskVerdict } from '../../composables/useDeskVerdict.js';
import StockChart from './StockChart.vue';
import SourceList from '../news/SourceList.vue';
import VerdictSteer from '../predictions/VerdictSteer.vue';

const props = defineProps({
  symbol: { type: String, required: true },
  quote: { type: Object, default: null },
  loading: Boolean
});

const ui = useUiStore();
const { t, te } = useI18n();
const { prediction, verdict, horizons } = useDeskVerdict(() => props.symbol);

const currency = computed(() => props.quote?.currency || 'USD');
const plan = computed(() => prediction.value?.tradePlan || null);
const indicators = computed(() => prediction.value?.indicators || null);
const briefing = computed(() => prediction.value?.briefing || verdict.value?.briefing || null);

const considered = computed(() => briefing.value?.considered || []);
const skipped = computed(() => briefing.value?.skipped || []);
const headlines = computed(() => (briefing.value?.headlines || []).filter(h => h?.title).slice(0, 8));
const world = computed(() => (briefing.value?.world || []).filter(w => w?.title).slice(0, 6));
const overlooked = computed(() => (verdict.value?.overlooked || []).filter(Boolean));
const notesReply = computed(() => String(briefing.value?.notesReply || '').trim());
const newsEvents = computed(() => prediction.value?.newsSentiment?.topEvents || []);

const claimCheck = computed(() => briefing.value?.claimCheck || '');
const claimCheckLabel = computed(() => {
  if (claimCheck.value === 'contradicted') return t('brief.claimContradicted');
  if (claimCheck.value === 'unverified') return t('brief.claimUnverified');
  if (claimCheck.value === 'confirmed') return t('brief.claimConfirmed');
  return '';
});
const claimCheckClass = computed(() => {
  if (claimCheck.value === 'contradicted') return 'text-bear';
  if (claimCheck.value === 'unverified') return 'text-neutral';
  if (claimCheck.value === 'confirmed') return 'text-bull';
  return 'text-gray-500';
});
const notesImpactLabel = computed(() => {
  if (!notesReply.value) return '';
  if (claimCheck.value === 'contradicted' || claimCheck.value === 'unverified') return '';
  const impact = briefing.value?.notesImpact || '';
  if (impact === 'changed') return t('brief.impactChanged');
  if (impact === 'tilted') return t('brief.impactTilted');
  return t('brief.impactNone');
});

const week52Pct = computed(() => {
  const fromInd = indicators.value?.week52Position;
  if (fromInd != null && !Number.isNaN(Number(fromInd))) return Number(fromInd) * 100;
  const q = props.quote;
  if (q?.week52High == null || q?.week52Low == null || q?.price == null) return null;
  const span = Number(q.week52High) - Number(q.week52Low);
  if (!span) return null;
  return ((Number(q.price) - Number(q.week52Low)) / span) * 100;
});

const quoteStats = computed(() => {
  const q = props.quote;
  if (!q) return [];
  const cur = currency.value;
  const rows = [
    { key: 'open', label: t('detail.open'), value: q.open != null ? formatPrice(q.open, cur) : null },
    { key: 'prev', label: t('detail.prevClose'), value: q.previousClose != null ? formatPrice(q.previousClose, cur) : null },
    { key: 'high', label: t('detail.dayHigh'), value: q.dayHigh != null ? formatPrice(q.dayHigh, cur) : null },
    { key: 'low', label: t('detail.dayLow'), value: q.dayLow != null ? formatPrice(q.dayLow, cur) : null },
    { key: 'vol', label: t('detail.volume'), value: q.volume != null ? formatCompact(q.volume) : null },
    { key: 'cap', label: t('detail.marketCap'), value: q.marketCap != null ? formatCompact(q.marketCap) : null }
  ];
  if (ui.isPro) {
    rows.push(
      { key: 'pe', label: t('detail.pe'), value: q.pe != null ? formatNumber(q.pe, 1) : null },
      { key: 'eps', label: t('detail.eps'), value: q.eps != null ? formatNumber(q.eps, 2) : null },
      { key: 'avgVol', label: t('detail.avgVolume'), value: q.avgVolume != null ? formatCompact(q.avgVolume) : null },
      { key: 'beta', label: t('detail.beta'), value: q.beta != null ? formatNumber(q.beta, 2) : null },
      { key: 'exch', label: t('detail.exchange'), value: q.exchange || null }
    );
  }
  return rows.filter(r => r.value != null && r.value !== '—');
});

const tapeStats = computed(() => {
  const ind = indicators.value;
  if (!ind) return [];
  const cur = currency.value;
  const macd = ind.macd?.histogram != null ? formatNumber(ind.macd.histogram, 3) : null;
  return [
    { key: 'trend', label: t('detail.trend'), value: prediction.value?.trend?.label || null },
    { key: 'rsi', label: t('detail.rsi'), value: ind.rsi != null ? formatNumber(ind.rsi, 1) : null },
    { key: 'adx', label: t('detail.adx'), value: ind.adx != null ? formatNumber(ind.adx, 1) : null },
    { key: 'atr', label: t('detail.atr'), value: ind.atr != null ? formatPrice(ind.atr, cur) : null },
    { key: 'macd', label: t('detail.macd'), value: macd },
    { key: 'stoch', label: t('detail.stoch'), value: ind.stochK != null ? formatNumber(ind.stochK, 1) : null },
    { key: 'mfi', label: t('detail.mfi'), value: ind.mfi != null ? formatNumber(ind.mfi, 1) : null },
    { key: 'sma20', label: t('detail.sma20'), value: ind.sma20 != null ? formatPrice(ind.sma20, cur) : null },
    { key: 'sma50', label: t('detail.sma50'), value: ind.sma50 != null ? formatPrice(ind.sma50, cur) : null },
    { key: 'sma200', label: t('detail.sma200'), value: ind.sma200 != null ? formatPrice(ind.sma200, cur) : null },
    { key: 'w52', label: t('detail.week52'), value: ind.week52Position != null ? `${Math.round(ind.week52Position * 100)}%` : null }
  ].filter(r => r.value);
});

const SIGNAL_LABELS = {
  rsi: 'RSI', macd: 'MACD', sma_crossover: 'SMA-X', ema_crossover: 'EMA-X',
  bollinger: 'BB', volume_trend: 'Vol', news_sentiment: 'News',
  stochastic: 'Stoch', adx_trend: 'ADX', mfi: 'MFI', breakout: 'Brkout',
  momentum: 'Mom', trend_regime: 'Trend'
};

const displaySignals = computed(() => {
  const s = prediction.value?.signals;
  if (!s) return [];
  return Object.entries(s)
    .filter(([, v]) => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 10)
    .map(([key, value]) => ({ key, value, label: SIGNAL_LABELS[key] || key }));
});

function eventLabel(ev) {
  if (ev?.id && te(`picks.events.${ev.id}`)) return t(`picks.events.${ev.id}`);
  return ev?.label || '';
}

function hrefOf(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch {
    return '';
  }
}
</script>

<style scoped>
.detail-section {
  padding: 2.25rem 1rem 2.5rem;
}
@media (min-width: 640px) {
  .detail-section {
    padding: 2.5rem 1.5rem 2.75rem;
  }
}
@media (min-width: 1024px) {
  .detail-section {
    padding-left: 2rem;
    padding-right: 2rem;
  }
}
.detail-section:not(.detail-section--flush) > * {
  max-width: 64rem;
}
.detail-section--flush {
  padding: 0;
}
.detail-kicker {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
  margin-bottom: 1rem;
}
.verdict-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 0.5rem;
}
.verdict-stamp-label {
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  white-space: nowrap;
}
</style>
