<template>
  <div class="flex flex-col h-full overflow-hidden bg-surface">
    <div class="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-surface-300 flex-shrink-0 gap-2 sm:gap-3">
      <div class="min-w-0">
        <h1 class="text-sm font-medium text-gray-300">{{ ui.isSimple ? $t('picks.title') : $t('picks.titlePro') }}</h1>
        <p class="text-xs text-gray-500 mt-0.5">
          {{ ui.isSimple ? $t('picks.subtitle') : $t('picks.subtitlePro') }}
        </p>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <span v-if="scanner.error" class="text-xs text-bear font-mono hidden sm:inline">{{ scanner.error }}</span>
        <span v-if="lastScanAgo" class="text-xs text-gray-600 font-mono hidden sm:inline">{{ $t('time.updated', { ago: lastScanAgo }) }}</span>
        <button
          @click="rescan"
          :disabled="running"
          class="text-xs px-3 py-1.5 rounded font-mono border transition-colors flex items-center gap-1.5"
          :class="running ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
        >
          <span v-if="running" class="animate-spin inline-block w-3 h-3 border border-accent border-t-transparent rounded-full"></span>
          {{ running ? $t('picks.scanning') : $t('picks.rescan') }}
        </button>
      </div>
    </div>

    <div
      v-if="ui.isPro && meta"
      class="px-4 py-2 border-b border-surface-300/50 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-gray-500 flex-shrink-0"
    >
      <span v-if="meta.marketRegime?.label" class="text-gray-400">
        {{ $t('picks.market') }}
        <span :class="regimeColor(meta.marketRegime.label)">{{ regimeName(meta.marketRegime.label) }}</span>
      </span>
      <span v-if="meta.universe?.readyForScan">
        {{ $t('picks.universe', { ready: meta.universe.readyForScan, size: meta.universe.universeSize }) }}
        <span class="text-gray-600">{{ $t('picks.cached', { pct: meta.universe.coveragePct }) }}</span>
      </span>
      <span v-if="meta.backtest5d?.total">
        {{ $t('picks.backtest') }}
        <span :class="accColor(meta.backtest5d.accuracy)">{{ (meta.backtest5d.accuracy * 100).toFixed(1) }}%</span>
        <span class="text-gray-600"> ({{ meta.backtest5d.total }} OOS)</span>
      </span>
      <span v-if="meta.backtest5d?.expectancy != null">
        Exp: <span :class="meta.backtest5d.expectancy >= 0 ? 'text-bull' : 'text-bear'">{{ meta.backtest5d.expectancy?.toFixed(2) }}%</span>
        · PF {{ meta.backtest5d.profitFactor?.toFixed(2) }}
        · DD {{ (meta.backtest5d.maxDrawdown * 100).toFixed(1) }}%
      </span>
      <span v-if="meta.live5d?.total">
        {{ $t('picks.live') }}
        <span :class="accColor(meta.live5d.accuracy)">{{ (meta.live5d.accuracy * 100).toFixed(1) }}%</span>
      </span>
      <span v-if="meta.gates" class="text-gray-600">
        {{ $t('picks.gates', { score: (meta.gates.minScore * 100).toFixed(0), conf: (meta.gates.minConfidence * 100).toFixed(0), rr: meta.gates.minRR }) }}
      </span>
    </div>

    <div class="flex gap-1 px-4 py-2 border-b border-surface-300/50 flex-shrink-0 overflow-x-auto">
      <button
        v-for="f in filters"
        :key="f.value"
        @click="activeFilter = f.value"
        class="text-xs px-3 py-1 rounded font-mono transition-colors flex-shrink-0"
        :class="activeFilter === f.value ? f.activeClass : 'text-gray-500 hover:text-gray-300'"
      >
        {{ f.label }}
        <span v-if="f.count != null" class="ml-1 opacity-70">({{ f.count }})</span>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto panel-scroll">
      <div v-if="loading || running" class="flex items-center justify-center h-32 gap-2 text-gray-500 text-sm">
        <div class="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full"></div>
        <span>{{ ui.isSimple ? $t('picks.looking') : $t('picks.scanningPro') }}</span>
      </div>

      <div v-else-if="!filtered.length" class="flex flex-col items-center justify-center h-40 text-gray-500 text-sm gap-2 px-6 text-center">
        <span v-if="activeFilter === 'actionable'">{{ ui.isSimple ? $t('picks.emptySimple') : $t('picks.emptyPro') }}</span>
        <span v-else-if="activeFilter === 'watch'">{{ ui.isSimple ? $t('picks.emptyWatchSimple') : $t('picks.emptyWatchPro') }}</span>
        <span v-else>{{ $t('picks.emptyAll') }}</span>
        <p v-if="ui.isPro && activeFilter === 'actionable'" class="text-xs text-gray-600 max-w-sm">
          {{ $t('picks.emptyHint') }}
        </p>
        <button @click="rescan" class="text-xs text-accent hover:text-accent/70 mt-1">{{ $t('picks.runScan') }}</button>
      </div>

      <article
        v-for="(o, idx) in filtered"
        :key="o.ticker"
        class="border-b border-surface-300/30"
      >
        <div class="flex items-start gap-2 px-4 pt-4 pb-2">
          <span class="text-gray-600 font-mono text-xs w-5 flex-shrink-0 pt-1">{{ idx + 1 }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                class="font-mono text-base font-semibold text-white hover:text-accent"
                @click="openStock(o.ticker)"
              >{{ o.ticker }}</button>

              <span
                v-if="displayAction(o)"
                class="text-xs font-bold uppercase px-2 py-0.5 rounded flex-shrink-0"
                :class="actionBadge(displayAction(o))"
              >
                {{ actionLabel(displayAction(o)) }}
              </span>

              <span v-if="o.quality === 'high'" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent flex-shrink-0">{{ $t('picks.highConviction') }}</span>
              <span v-else-if="o.quality === 'watch'" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral/10 text-neutral flex-shrink-0">{{ $t('picks.watch') }}</span>
              <span v-else-if="ui.isPro && o.quality === 'medium'" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent/80 flex-shrink-0">{{ $t('picks.medium') }}</span>

              <template v-if="ui.isPro">
                <span v-if="o.crossPercentile != null" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-300 text-gray-400 flex-shrink-0">
                  {{ $t('picks.rank', { n: o.crossPercentile?.toFixed(0) }) }}
                </span>
                <span class="text-[10px] font-mono text-gray-600 ml-auto flex-shrink-0">
                  {{ $t('picks.confScore', { conf: Math.round((o.confidence || 0) * 100), score: o.score }) }}
                </span>
              </template>
            </div>

            <p class="mt-1.5 text-sm text-gray-300 leading-snug">
              <SourceLink :href="pickLead(o).url" :text="pickLead(o).title" />
            </p>
            <ul v-if="pickNewsItems(o).length" class="mt-1.5 space-y-1">
              <li v-for="item in pickNewsItems(o)" :key="item.title" class="text-xs text-gray-400 leading-snug">
                <SourceLink :href="item.url" :text="item.title" />
              </li>
            </ul>
            <div v-if="pickWhy(o).catalysts.length" class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-for="c in pickWhy(o).catalysts.slice(0, 3)"
                :key="c"
                class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-300 text-gray-400"
              >{{ c }}</span>
            </div>

            <div v-if="hasLevels(o)" class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span class="text-gray-500">{{ ui.isSimple ? $t('picks.around') : $t('picks.entry') }} <span class="font-mono text-gray-300">${{ fmt(o.entry) }}</span></span>
              <span class="text-gray-500">{{ ui.isSimple ? $t('picks.protect') : $t('picks.stop') }} <span class="font-mono text-bear">${{ fmt(o.stop) }}</span></span>
              <span class="text-gray-500">{{ ui.isSimple ? $t('picks.aim') : $t('picks.target') }} <span class="font-mono text-bull">${{ fmt(o.target) }}</span></span>
              <span v-if="ui.isPro && o.rr">R:R <span class="font-mono" :class="o.rr >= 1.5 ? 'text-bull' : 'text-neutral'">{{ o.rr.toFixed(1) }}</span></span>
            </div>
          </div>
        </div>

        <div class="pl-9 sm:pl-11 pr-3 sm:pr-4 pb-3">
          <button
            type="button"
            class="text-xs font-mono text-accent hover:text-accent/70"
            @click="toggle(o.ticker)"
          >
            {{ expanded === o.ticker ? $t('verdict.hideDetails') : (ui.isSimple ? (o.quality === 'watch' ? $t('picks.whyWatch') : $t('picks.whyPick')) : $t('verdict.fullBreakdown')) }}
          </button>

          <div v-if="expanded === o.ticker" class="mt-3 space-y-3">
            <template v-if="ui.isSimple">
              <ul v-if="simpleWhy(o).length" class="space-y-1">
                <li v-for="line in simpleWhy(o)" :key="line.title" class="text-sm text-gray-300 leading-relaxed">
                  <SourceLink :href="line.url" :text="line.title" />
                </li>
              </ul>
              <div v-if="o.quality === 'watch' && simpleWhyNot(o).length">
                <p class="text-xs font-mono text-gray-500 mb-1">{{ $t('picks.whyNotYet') }}</p>
                <ul class="space-y-1">
                  <li v-for="line in simpleWhyNot(o)" :key="line" class="text-sm text-gray-400 leading-relaxed">{{ line }}</li>
                </ul>
              </div>
            </template>

            <template v-else>
              <ul v-if="simpleWhy(o).length" class="space-y-1">
                <li v-for="line in simpleWhy(o)" :key="line.title" class="text-sm text-gray-300 leading-relaxed">
                  <SourceLink :href="line.url" :text="line.title" />
                </li>
              </ul>
              <p v-if="o.flags?.length" class="text-xs font-mono text-gray-500">
                {{ o.actionable ? $t('picks.notes') : $t('picks.notActionable') }}: {{ o.flags.map(simpleFlag).join(' · ') }}
              </p>
              <p v-if="o.newsCount > 0" class="text-[10px] font-mono text-gray-600">
                {{ $t('picks.newsContext', { n: o.newsCount }) }}
              </p>
            </template>

            <p v-if="earningsLine(o.earningsInDays)" class="text-xs text-neutral">
              {{ earningsLine(o.earningsInDays) }}
            </p>

            <button
              type="button"
              class="text-xs font-mono text-gray-400 hover:text-white"
              @click="openStock(o.ticker)"
            >
              {{ $t('common.open', { ticker: o.ticker }) }}
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useScannerStore } from '../stores/scannerStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { pickLead, pickNewsItems, pickWhy, simpleFlag, earningsLine, shortSentence } from '../utils/picks.js';
import SourceLink from '../components/news/SourceLink.vue';

const router = useRouter();
const scanner = useScannerStore();
const ui = useUiStore();
const { t } = useI18n();

const activeFilter = ref('actionable');
const expanded = ref(null);
let refreshInterval;

const opportunities = computed(() => scanner.opportunities);
const meta = computed(() => scanner.meta);
const loading = computed(() => scanner.loading.scan);
const running = computed(() => scanner.loading.running);
const lastScanAgo = computed(() => scanner.lastScanAgo);

const filtered = computed(() => {
  const list = opportunities.value;
  if (activeFilter.value === 'actionable') return list.filter(o => o.actionable);
  if (activeFilter.value === 'watch') return list.filter(o => o.quality === 'watch');
  if (activeFilter.value === 'buy') return list.filter(o => o.action === 'BUY');
  if (activeFilter.value === 'sell') return list.filter(o => o.action === 'SELL');
  return list;
});

const filters = computed(() => {
  const base = [
    { value: 'actionable', label: t('picks.filterPicks'), count: scanner.actionable.length, activeClass: 'text-accent bg-accent/10' },
    { value: 'watch', label: t('picks.filterWatch'), count: scanner.watchlist.length, activeClass: 'text-neutral bg-neutral/10' }
  ];
  if (!ui.isPro) return base;
  return [
    ...base,
    { value: 'buy', label: t('picks.filterBuy'), count: scanner.buys.length, activeClass: 'text-bull bg-bull/10' },
    { value: 'sell', label: t('picks.filterSell'), count: scanner.sells.length, activeClass: 'text-bear bg-bear/10' },
    { value: 'all', label: t('picks.filterAll'), count: opportunities.value.length, activeClass: 'text-gray-300 bg-surface-200' }
  ];
});

watch(() => ui.isSimple, (simple) => {
  if (simple && !['actionable', 'watch'].includes(activeFilter.value)) {
    activeFilter.value = 'actionable';
  }
});

function displayAction(o) {
  if (ui.isSimple && o.quality === 'watch') return null;
  if (ui.isPro && !o.actionable && (o.rawSignal === 'BUY' || o.rawSignal === 'SELL')) return o.rawSignal;
  return o.action;
}

function hasLevels(o) {
  return o.entry != null && (o.action !== 'HOLD' || o.rawSignal === 'BUY' || o.rawSignal === 'SELL');
}

function simpleWhy(o) {
  const why = pickWhy(o);
  const head = pickLead(o);
  return [
    ...why.headlines.filter(h => h.title !== head.title && shortSentence(h.title, 120) !== head.title),
    ...why.lines.filter(line => line && line !== head.title).map(title => ({ title, url: '' }))
  ];
}

function simpleWhyNot(o) {
  return (o.flags || []).map(simpleFlag).filter(Boolean);
}

function accColor(acc) {
  if (acc == null) return 'text-gray-500';
  if (acc >= 0.55) return 'text-bull';
  if (acc >= 0.48) return 'text-gray-300';
  return 'text-neutral';
}

function regimeColor(label) {
  if (label === 'risk-on') return 'text-bull';
  if (label === 'risk-off') return 'text-bear';
  if (label === 'caution') return 'text-neutral';
  return 'text-gray-400';
}

function actionBadge(action) {
  if (action === 'BUY') return 'bg-bull/15 text-bull border border-bull/30';
  if (action === 'SELL') return 'bg-bear/15 text-bear border border-bear/30';
  return 'bg-neutral/10 text-neutral border border-neutral/30';
}

function actionLabel(action) {
  if (action === 'BUY') return t('action.buy');
  if (action === 'SELL') return t('action.sell');
  return t('action.hold');
}

function regimeName(label) {
  const key = `regime.${label}`;
  const out = t(key);
  return out === key ? label : out;
}

function fmt(v) {
  return v != null ? Number(v).toFixed(2) : '—';
}

function toggle(ticker) {
  expanded.value = expanded.value === ticker ? null : ticker;
}

function openStock(ticker) {
  router.push({ name: 'stock', params: { symbol: ticker } });
}

async function rescan() {
  await scanner.runScan();
}

onMounted(async () => {
  await scanner.init();
  refreshInterval = setInterval(() => scanner.refresh(), 5 * 60_000);
});

onUnmounted(() => {
  clearInterval(refreshInterval);
});
</script>
