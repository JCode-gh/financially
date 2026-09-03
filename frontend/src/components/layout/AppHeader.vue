<template>
  <header class="bg-surface-100 border-b border-surface-300 flex-shrink-0 relative z-30">
    <div class="px-3 md:px-4 h-12 flex items-center justify-between gap-2 md:gap-4">
      <div class="flex items-center gap-3 md:gap-6 flex-shrink-0 min-w-0">
        <RouterLink to="/" class="flex items-center gap-2 hover:opacity-90 transition-opacity focus-visible:ring-2 ring-accent/50 rounded">
          <svg class="w-5 h-5 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
            <polyline points="16 7 22 7 22 13"></polyline>
          </svg>
          <span class="text-white font-bold text-sm tracking-tight">FINANCIALLY</span>
        </RouterLink>

        <nav class="hidden lg:flex items-center gap-1">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="text-xs font-mono px-3 py-1.5 rounded transition-colors focus-visible:ring-2 ring-accent/50"
            :class="isActive(link) ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
      </div>

      <div class="relative hidden lg:block flex-1 max-w-sm">
        <input
          v-model="searchQuery"
          @input="onSearch"
          @keydown.escape="clearSearch"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="selectHighlighted"
          :aria-expanded="searchResults.length > 0"
          aria-controls="search-results"
          :placeholder="$t('search.placeholder')"
          class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent/50 focus-visible:ring-2 ring-accent/40 font-mono"
        />
        <button
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gray-600 hidden lg:block"
          @click="ui.commandOpen = true"
          :title="$t('search.command')"
        >⌘K</button>
        <div
          v-if="searchResults.length > 0"
          id="search-results"
          class="absolute top-full left-0 right-0 mt-1 bg-surface-200 border border-surface-300 rounded shadow-xl z-50 max-h-80 overflow-y-auto"
        >
          <button
            v-for="(r, i) in searchResults.slice(0, 10)"
            :key="r.symbol"
            @click="selectResult(r)"
            class="w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-surface-300/40 last:border-0"
            :class="i === highlight ? 'bg-surface-300' : 'hover:bg-surface-300'"
          >
            <div class="flex-shrink-0">
              <div class="font-mono text-accent font-semibold text-sm">{{ r.symbol }}</div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <span v-if="r.market" class="text-[10px] text-gray-500 font-mono">{{ r.market }}</span>
                <span v-if="r.type === 'ETF'" class="text-[10px] text-accent/80 font-mono px-1 rounded bg-accent/10">ETF</span>
              </div>
            </div>
            <div class="text-gray-400 text-xs leading-snug min-w-0">{{ r.name }}</div>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
        <button
          type="button"
          class="lg:hidden p-1.5 text-gray-400 hover:text-accent rounded"
          :aria-label="$t('search.open')"
          @click="ui.commandOpen = true"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <div class="hidden lg:flex items-center rounded-md border border-surface-300 overflow-hidden" role="group" :aria-label="$t('lang.group')">
          <button
            type="button"
            @click="setLang('nl')"
            class="text-[11px] font-mono px-2 py-1 transition-colors"
            :class="locale === 'nl' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >{{ $t('lang.nl') }}</button>
          <button
            type="button"
            @click="setLang('en')"
            class="text-[11px] font-mono px-2 py-1 transition-colors border-l border-surface-300"
            :class="locale === 'en' ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >{{ $t('lang.en') }}</button>
        </div>
        <div class="hidden lg:flex items-center rounded-md border border-surface-300 overflow-hidden" role="group" :aria-label="$t('mode.group')">
          <button
            type="button"
            @click="setMode('simple')"
            class="text-[11px] font-mono px-2.5 py-1 transition-colors"
            :class="ui.isSimple ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >{{ $t('mode.simple') }}</button>
          <button
            type="button"
            @click="setMode('pro')"
            class="text-[11px] font-mono px-2.5 py-1 transition-colors border-l border-surface-300"
            :class="ui.isPro ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300'"
          >{{ $t('mode.pro') }}</button>
        </div>
        <div v-if="authStore.firebaseEnabled" class="relative hidden lg:block">
          <button
            v-if="!authStore.isLoggedIn"
            @click="showAuth = true"
            class="text-xs font-mono px-2.5 py-1 rounded text-gray-400 hover:text-accent border border-surface-300 hover:border-accent/40 transition-colors focus-visible:ring-2 ring-accent/50"
          >
            {{ $t('auth.signIn') }}
          </button>
          <div v-else class="flex items-center gap-2 relative" @click.stop>
            <span v-if="authStore.syncing" class="text-[10px] text-gray-600 font-mono animate-pulse">{{ $t('auth.syncing') }}</span>
            <button
              @click="userMenuOpen = !userMenuOpen"
              class="text-xs font-mono px-2.5 py-1 rounded text-accent bg-accent/10 hover:bg-accent/20 transition-colors max-w-[120px] truncate"
              :title="authStore.user?.email"
            >
              {{ authStore.displayName }}
            </button>
            <div
              v-if="userMenuOpen"
              class="absolute right-0 top-full mt-1 bg-surface-200 border border-surface-300 rounded shadow-xl z-50 min-w-[140px] py-1"
              @click.stop
            >
              <div class="px-3 py-1.5 text-[10px] text-gray-500 font-mono truncate border-b border-surface-300/50">
                {{ authStore.user?.email }}
              </div>
              <button
                @click="signOut"
                class="w-full text-left px-3 py-2 text-xs font-mono text-gray-400 hover:text-bear hover:bg-surface-300/50"
              >
                {{ $t('auth.signOut') }}
              </button>
            </div>
          </div>
        </div>
        <button
          @click="refresh"
          :class="refreshing ? 'animate-spin' : ''"
          class="hidden lg:inline-flex text-gray-400 hover:text-accent transition-colors focus-visible:ring-2 ring-accent/50 rounded p-1"
          :title="$t('common.refresh')"
          :aria-label="$t('common.refreshData')"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>

        <button
          type="button"
          class="lg:hidden p-1.5 text-gray-400 hover:text-white rounded"
          :aria-label="menuOpen ? $t('nav.close') : $t('nav.menu')"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <svg v-if="!menuOpen" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
          </svg>
          <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div
      v-if="menuOpen"
      class="lg:hidden border-t border-surface-300 bg-surface-100 px-3 py-3 space-y-2"
    >
      <div class="grid grid-cols-2 rounded-md border border-surface-300 overflow-hidden" role="group" :aria-label="$t('lang.group')">
        <button type="button" @click="setLang('nl')" class="text-xs font-mono py-2" :class="locale === 'nl' ? 'bg-accent/20 text-accent' : 'text-gray-500'">{{ $t('lang.nl') }}</button>
        <button type="button" @click="setLang('en')" class="text-xs font-mono py-2 border-l border-surface-300" :class="locale === 'en' ? 'bg-accent/20 text-accent' : 'text-gray-500'">{{ $t('lang.en') }}</button>
      </div>
      <div class="grid grid-cols-2 rounded-md border border-surface-300 overflow-hidden" role="group" :aria-label="$t('mode.group')">
        <button type="button" @click="setMode('simple')" class="text-xs font-mono py-2 px-1" :class="ui.isSimple ? 'bg-accent/20 text-accent' : 'text-gray-500'">{{ $t('mode.simple') }}</button>
        <button type="button" @click="setMode('pro')" class="text-xs font-mono py-2 px-1 border-l border-surface-300" :class="ui.isPro ? 'bg-accent/20 text-accent' : 'text-gray-500'">{{ $t('mode.pro') }}</button>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="authStore.firebaseEnabled && !authStore.isLoggedIn"
          @click="showAuth = true; menuOpen = false"
          class="flex-1 text-xs font-mono py-2 rounded text-gray-400 border border-surface-300"
        >{{ $t('auth.signIn') }}</button>
        <button
          v-else-if="authStore.firebaseEnabled"
          @click="signOut"
          class="flex-1 text-xs font-mono py-2 rounded text-gray-400 border border-surface-300"
        >{{ $t('auth.signOut') }}</button>
        <button
          @click="refresh(); menuOpen = false"
          class="flex-1 text-xs font-mono py-2 rounded text-accent border border-accent/40"
        >{{ $t('common.refresh') }}</button>
      </div>
    </div>

    <AuthModal :open="showAuth" @close="showAuth = false" />
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { setAppLocale } from '../../i18n/index.js';
import { useMarketStore } from '../../stores/marketStore.js';
import { useNewsStore } from '../../stores/newsStore.js';
import { useScannerStore } from '../../stores/scannerStore.js';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useUiStore } from '../../stores/uiStore.js';
import AuthModal from '../auth/AuthModal.vue';

const route = useRoute();
const router = useRouter();
const marketStore = useMarketStore();
const newsStore = useNewsStore();
const scannerStore = useScannerStore();
const predictionStore = usePredictionStore();
const authStore = useAuthStore();
const ui = useUiStore();
const { t, locale } = useI18n();

const links = computed(() => [
  { to: '/', name: 'dashboard', label: t('nav.terminal'), extra: [] },
  { to: '/watchlist', name: 'stocks', label: t('nav.watchlist'), extra: ['stock'] },
  { to: '/opportunities', name: 'opportunities', label: t('nav.picks'), extra: [] },
  { to: '/news', name: 'news', label: t('nav.news'), extra: [] },
  { to: '/chat', name: 'chat', label: t('nav.chat'), extra: [] }
]);

function setMode(mode) {
  ui.setDeskMode(mode);
}

function setLang(lang) {
  setAppLocale(lang);
}

function isActive(link) {
  return route.name === link.name || link.extra.includes(route.name);
}

const searchQuery = ref('');
const highlight = ref(0);
const refreshing = ref(false);
const showAuth = ref(false);
const userMenuOpen = ref(false);
const menuOpen = ref(false);
const searchResults = computed(() => marketStore.searchResults);

watch(() => route.fullPath, () => { menuOpen.value = false; });

function onDocClick() {
  userMenuOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

async function signOut() {
  userMenuOpen.value = false;
  menuOpen.value = false;
  await authStore.logout();
}

let searchTimer;
function onSearch() {
  highlight.value = 0;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => marketStore.searchSymbol(searchQuery.value), 300);
}

function clearSearch() {
  searchQuery.value = '';
  marketStore.searchResults = [];
}

function move(dir) {
  const n = Math.min(10, searchResults.value.length);
  if (!n) return;
  highlight.value = (highlight.value + dir + n) % n;
}

function selectHighlighted() {
  const r = searchResults.value[highlight.value];
  if (r) selectResult(r);
}

async function selectResult(r) {
  clearSearch();
  router.push({ name: 'stock', params: { symbol: r.symbol } });
}

async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  const jobs = [
    marketStore.fetchMarket(),
    marketStore.fetchWatchlist(),
    ui.checkHealth()
  ];
  if (route.name === 'news' || route.name === 'dashboard') {
    const quotes = marketStore.watchlistData || [];
    jobs.push(newsStore.fetchMarketNews(
      quotes.map(q => q.symbol).filter(Boolean),
      quotes.map(q => q.name || '')
    ));
  }
  if (route.name === 'opportunities' || route.name === 'dashboard') jobs.push(scannerStore.refresh());
  if (route.name === 'stock') jobs.push(predictionStore.generateForSymbol(route.params.symbol));
  await Promise.allSettled(jobs);
  setTimeout(() => { refreshing.value = false; }, 600);
}
</script>
