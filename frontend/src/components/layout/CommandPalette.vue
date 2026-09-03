<template>
  <Teleport to="body">
    <div
      v-if="ui.commandOpen"
      class="fixed inset-0 z-[90] bg-black/60 flex items-start justify-center pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-[12vh] px-3 sm:px-4"
      @click.self="close"
    >
      <div
        class="w-full max-w-lg card shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        :aria-label="$t('command.label')"
      >
        <input
          ref="inputEl"
          v-model="query"
          @input="onSearch"
          @keydown.escape="close"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="runActive"
          :placeholder="$t('command.placeholder')"
          class="w-full bg-surface-200 border-b border-surface-300 px-4 py-3 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
        />
        <div class="max-h-80 overflow-y-auto panel-scroll">
          <button
            v-for="(item, i) in items"
            :key="item.id"
            @click="run(item)"
            class="w-full text-left px-4 py-2.5 text-sm font-mono border-b border-surface-300/30 last:border-0"
            :class="i === active ? 'bg-accent/10 text-accent' : 'text-gray-300 hover:bg-surface-200/60'"
          >
            <span class="text-gray-500 mr-2">{{ item.kind }}</span>
            {{ item.label }}
            <span v-if="item.hint" class="text-gray-600 ml-2">{{ item.hint }}</span>
          </button>
          <div v-if="!items.length" class="px-4 py-6 text-xs text-gray-600 font-mono text-center">
            {{ $t('common.noMatches') }}
          </div>
        </div>
        <div class="px-4 py-1.5 text-[10px] font-mono text-gray-600 border-t border-surface-300">
          {{ $t('command.hint') }}
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { setAppLocale } from '../../i18n/index.js';
import { useUiStore } from '../../stores/uiStore.js';
import { useMarketStore } from '../../stores/marketStore.js';

const ui = useUiStore();
const market = useMarketStore();
const router = useRouter();
const { t, locale } = useI18n();
const query = ref('');
const active = ref(0);
const inputEl = ref(null);

const pages = computed(() => [
  { id: 'dash', kind: t('common.go'), label: t('nav.terminal'), hint: '/', run: () => router.push({ name: 'dashboard' }) },
  { id: 'wl', kind: t('common.go'), label: t('nav.watchlist'), hint: '/watchlist', run: () => router.push({ name: 'stocks' }) },
  { id: 'picks', kind: t('common.go'), label: t('nav.picks'), hint: '/opportunities', run: () => router.push({ name: 'opportunities' }) },
  { id: 'news', kind: t('common.go'), label: t('nav.news'), hint: '/news', run: () => router.push({ name: 'news' }) },
  { id: 'chat', kind: t('common.go'), label: t('nav.chat'), hint: '/chat', run: () => router.push({ name: 'chat' }) },
  {
    id: 'mode',
    kind: t('mode.group'),
    label: ui.isPro ? t('mode.switchSimple') : t('mode.switchPro'),
    hint: ui.isPro ? t('mode.hideIndicators') : t('mode.showIndicators'),
    run: () => ui.setDeskMode(ui.isPro ? 'simple' : 'pro')
  },
  {
    id: 'lang',
    kind: t('lang.group'),
    label: locale.value === 'nl' ? t('command.languageEn') : t('command.languageNl'),
    hint: locale.value === 'nl' ? 'EN' : 'NL',
    run: () => setAppLocale(locale.value === 'nl' ? 'en' : 'nl')
  }
]);

const items = computed(() => {
  const q = query.value.trim().toLowerCase();
  const nav = pages.value.filter(p => !q || p.label.toLowerCase().includes(q) || (p.hint && p.hint.includes(q)));
  const stocks = (market.searchResults || []).slice(0, 8).map(r => ({
    id: `s-${r.symbol}`,
    kind: r.symbol,
    label: r.name || r.symbol,
    hint: r.market || r.exchange || '',
    run: () => router.push({ name: 'stock', params: { symbol: r.symbol } })
  }));
  return [...nav, ...stocks];
});

watch(() => ui.commandOpen, async (open) => {
  if (!open) return;
  query.value = '';
  active.value = 0;
  market.searchResults = [];
  await nextTick();
  inputEl.value?.focus();
});

watch(items, () => { active.value = 0; });

let timer;
function onSearch() {
  clearTimeout(timer);
  timer = setTimeout(() => market.searchSymbol(query.value), 180);
}

function move(dir) {
  const n = items.value.length;
  if (!n) return;
  active.value = (active.value + dir + n) % n;
}

function run(item) {
  close();
  item.run();
}

function runActive() {
  const item = items.value[active.value];
  if (item) run(item);
}

function close() {
  ui.commandOpen = false;
}
</script>
