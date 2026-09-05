<template>
  <section>
    <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div class="min-w-0">
        <h2 class="text-sm font-medium text-white">{{ $t('dashboard.book') }}</h2>
        <p class="mt-0.5 text-[11px] font-mono text-gray-500">
          {{ $t('dashboard.bookHint', { n: rows.length, name: listName }) }}
        </p>
      </div>
      <form class="flex items-center gap-2" @submit.prevent="addSymbol">
        <input
          v-model="newSymbol"
          :placeholder="$t('dashboard.addPlaceholder')"
          class="w-36 sm:w-44 bg-surface-200 border border-surface-300 rounded px-2.5 py-1.5 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 uppercase"
        />
        <button
          type="submit"
          class="text-xs font-mono text-accent hover:text-accent/70"
        >{{ $t('watch.add') }}</button>
      </form>
    </div>

    <div
      v-if="topMovers.gainers.length || topMovers.losers.length"
      class="mb-4 flex flex-wrap gap-2 text-[11px] font-mono"
    >
      <span
        v-for="g in topMovers.gainers.slice(0, 3)"
        :key="`up-${g.symbol}`"
        class="px-2 py-1 rounded bg-bull/10 text-bull"
      >▲ {{ g.symbol }} {{ formatPct(g.changePct) }}</span>
      <span
        v-for="l in topMovers.losers.slice(0, 3)"
        :key="`dn-${l.symbol}`"
        class="px-2 py-1 rounded bg-bear/10 text-bear"
      >▼ {{ l.symbol }} {{ formatPct(l.changePct) }}</span>
    </div>

    <div v-if="loading" class="flex items-center justify-center h-28">
      <div class="animate-spin w-5 h-5 border-2 border-accent border-t-transparent rounded-full"></div>
    </div>

    <div
      v-else-if="!rows.length"
      class="card px-5 py-10 text-center"
    >
      <p class="text-sm text-gray-300">{{ $t('dashboard.bookEmpty') }}</p>
      <p class="mt-1 text-xs font-mono text-gray-600">{{ $t('dashboard.bookEmptyHint') }}</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <article
        v-for="row in rows"
        :key="row.symbol"
        class="card p-4 flex flex-col gap-3 cursor-pointer transition-colors"
        :class="row.selected ? 'border-accent/50 bg-accent/5' : 'hover:border-accent/30'"
        @click="select(row.symbol)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="font-mono text-base font-semibold" :class="row.selected ? 'text-accent' : 'text-white'">
                {{ row.symbol }}
              </h3>
              <span
                v-if="row.earnings"
                class="text-[10px] font-mono px-1.5 py-px rounded"
                :class="row.earnings.cls"
              >{{ row.earnings.text }}</span>
              <span
                v-if="row.callLabel"
                class="text-[10px] font-mono px-1.5 py-px rounded border"
                :class="row.callCls"
              >{{ row.callLabel }}</span>
            </div>
            <p class="text-xs text-gray-500 truncate mt-0.5">{{ row.name }}</p>
          </div>
          <div class="text-right flex-shrink-0">
            <div class="font-mono text-base font-semibold text-white">{{ formatPrice(row.price, row.currency) }}</div>
            <div class="font-mono text-xs" :class="(row.changePct || 0) >= 0 ? 'text-bull' : 'text-bear'">
              {{ formatPct(row.changePct) }}
            </div>
          </div>
        </div>

        <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-[11px] font-mono">
          <div v-for="stat in row.stats" :key="stat.key">
            <dt class="text-gray-600">{{ stat.label }}</dt>
            <dd class="text-gray-300 mt-0.5">{{ stat.value }}</dd>
          </div>
        </dl>

        <p v-if="row.headline" class="text-sm text-gray-300 leading-snug line-clamp-2">
          {{ row.headline }}
        </p>
        <p v-else-if="row.scanReason" class="text-xs font-mono text-gray-500 line-clamp-2">
          {{ row.scanReason }}
        </p>
        <p v-else class="text-[11px] font-mono text-gray-600">{{ $t('dashboard.noCall') }}</p>

        <p v-if="row.doNow" class="text-[11px] font-mono text-accent line-clamp-2">
          {{ $t('verdict.doNow', { text: row.doNow }) }}
        </p>

        <p v-if="row.news" class="text-[11px] font-mono text-gray-500 line-clamp-2">
          <span class="text-gray-600">{{ $t('dashboard.headlines') }} · </span>{{ row.news }}
        </p>

        <div class="mt-auto pt-1 flex items-center justify-between gap-2">
          <RouterLink
            :to="{ name: 'stock', params: { symbol: row.symbol } }"
            class="text-[11px] font-mono text-gray-400 hover:text-accent"
            @click.stop
          >{{ $t('dashboard.openName', { symbol: row.symbol }) }}</RouterLink>
          <button
            type="button"
            class="text-gray-600 hover:text-bear p-1"
            :aria-label="$t('common.removeFromWatchlist')"
            @click.stop="remove(row.symbol)"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMarketStore } from '../../stores/marketStore.js';
import { useNewsStore } from '../../stores/newsStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { useScannerStore } from '../../stores/scannerStore.js';
import { formatCompact, formatNumber, formatPct, formatPrice } from '../../utils/format.js';

const market = useMarketStore();
const news = useNewsStore();
const predictions = usePredictionStore();
const scanner = useScannerStore();
const { t } = useI18n();

const newSymbol = ref('');

const listName = computed(() => market.activeWatchlist?.name || t('watch.defaultList'));
const topMovers = computed(() => market.topMovers);
const loading = computed(() =>
  market.loading.watchlist &&
  market.watchlistSymbols.length > 0 &&
  !market.watchlistData.length
);

function earningsBadge(symbol) {
  const e = scanner.earnings[symbol];
  if (!e || e.daysUntil == null || e.daysUntil < 0 || e.daysUntil > 7) return null;
  return {
    text: e.daysUntil === 0 ? t('watch.eToday') : `E-${e.daysUntil}`,
    cls: e.daysUntil <= 2 ? 'bg-neutral/20 text-neutral' : 'bg-surface-300 text-gray-400'
  };
}

function callMeta(symbol) {
  const pred = predictions.byTicker?.[symbol];
  const ai = pred?.ai;
  const scan = scanner.opportunities.find(o => o.ticker === symbol);
  if (ai?.action) {
    const action = String(ai.action).toUpperCase();
    const cls = action === 'BUY' || action === 'LONG'
      ? 'border-bull/40 text-bull bg-bull/10'
      : action === 'SELL' || action === 'SHORT'
        ? 'border-bear/40 text-bear bg-bear/10'
        : 'border-neutral/40 text-neutral bg-neutral/10';
    return {
      label: `${action}${ai.conviction != null ? ` ${ai.conviction}%` : ''}`,
      cls,
      headline: ai.thesis || '',
      doNow: ai.doNow || ''
    };
  }
  if (scan?.action) {
    const action = String(scan.action).toUpperCase();
    const cls = action === 'BUY'
      ? 'border-bull/40 text-bull bg-bull/10'
      : action === 'SELL'
        ? 'border-bear/40 text-bear bg-bear/10'
        : 'border-surface-300 text-gray-400';
    return {
      label: action,
      cls,
      headline: '',
      doNow: '',
      scanReason: (scan.reasons || []).slice(0, 2).join(' · ')
    };
  }
  return { label: '', cls: '', headline: '', doNow: '', scanReason: '' };
}

function quoteStats(stock) {
  const cur = stock.currency;
  const items = [
    { key: 'open', label: t('detail.open'), value: stock.open != null ? formatPrice(stock.open, cur) : null },
    { key: 'high', label: t('detail.dayHigh'), value: stock.dayHigh != null ? formatPrice(stock.dayHigh, cur) : null },
    { key: 'low', label: t('detail.dayLow'), value: stock.dayLow != null ? formatPrice(stock.dayLow, cur) : null },
    { key: 'vol', label: t('detail.volume'), value: stock.volume != null ? formatCompact(stock.volume) : null },
    { key: 'cap', label: t('detail.marketCap'), value: stock.marketCap != null ? formatCompact(stock.marketCap) : null },
    { key: 'pe', label: t('detail.pe'), value: stock.pe != null ? formatNumber(stock.pe, 1) : null }
  ];
  if (stock.week52Low != null && stock.week52High != null) {
    items.push({
      key: 'w52',
      label: t('dashboard.week52'),
      value: `${formatPrice(stock.week52Low, cur)} – ${formatPrice(stock.week52High, cur)}`
    });
  }
  const pred = predictions.byTicker?.[stock.symbol];
  const support = pred?.indicators?.support;
  const resist = pred?.indicators?.resistance;
  if (support != null) items.push({ key: 'sup', label: t('detail.support'), value: formatPrice(support, cur) });
  if (resist != null) items.push({ key: 'res', label: t('detail.resistance'), value: formatPrice(resist, cur) });
  return items.filter(i => i.value);
}

function latestNews(symbol) {
  const all = [...(news.articles || []), ...(news.stockArticles || [])];
  const hit = all.find(a => (a.matchedSymbols || []).includes(symbol));
  return hit?.headline || '';
}

const rows = computed(() => {
  const quotes = market.watchlistData || [];
  const bySym = new Map(quotes.map(q => [q.symbol, q]));
  return market.watchlistSymbols.map(symbol => {
    const stock = bySym.get(symbol) || { symbol, name: symbol, price: null, changePct: null };
    const call = callMeta(symbol);
    return {
      symbol,
      name: stock.name || symbol,
      price: stock.price,
      changePct: stock.changePct,
      currency: stock.currency,
      selected: market.selectedSymbol === symbol,
      earnings: earningsBadge(symbol),
      callLabel: call.label,
      callCls: call.cls,
      headline: call.headline,
      doNow: call.doNow,
      scanReason: call.scanReason,
      stats: quoteStats(stock),
      news: latestNews(symbol)
    };
  });
});

async function select(symbol) {
  await market.selectSymbol(symbol);
}

async function addSymbol() {
  const raw = newSymbol.value.trim();
  if (!raw) return;
  const added = await market.addToWatchlist(raw);
  newSymbol.value = '';
  if (added) await market.selectSymbol(added);
}

function remove(symbol) {
  market.removeFromWatchlist(symbol);
}
</script>
