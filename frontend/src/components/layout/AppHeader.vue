<template>
  <header class="bg-surface-100 border-b border-surface-300 px-4 h-12 flex items-center justify-between gap-4 flex-shrink-0">
    <!-- Logo + nav -->
    <div class="flex items-center gap-6 flex-shrink-0">
      <RouterLink to="/" class="flex items-center gap-2 hover:opacity-90 transition-opacity">
        <svg class="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
          <polyline points="16 7 22 7 22 13"></polyline>
        </svg>
        <span class="text-white font-bold text-sm tracking-tight">FINANCIALLY</span>
      </RouterLink>

      <nav class="flex items-center gap-1">
        <RouterLink
          to="/"
          class="text-xs font-mono px-3 py-1.5 rounded transition-colors"
          :class="route.name === 'stocks' || route.name === 'stock' ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'"
        >
          Stocks
        </RouterLink>
        <RouterLink
          to="/opportunities"
          class="text-xs font-mono px-3 py-1.5 rounded transition-colors"
          :class="route.name === 'opportunities' ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'"
        >
          Picks
        </RouterLink>
        <RouterLink
          to="/news"
          class="text-xs font-mono px-3 py-1.5 rounded transition-colors"
          :class="route.name === 'news' ? 'text-accent bg-accent/10' : 'text-gray-500 hover:text-gray-300'"
        >
          News
        </RouterLink>
      </nav>
    </div>

    <!-- Search -->
    <div class="relative flex-1 max-w-sm">
      <input
        v-model="searchQuery"
        @input="onSearch"
        @keydown.escape="clearSearch"
        placeholder="Search by name or ticker (e.g. KBC Ancora)"
        class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent/50 font-mono"
      />
      <div v-if="searchResults.length > 0" class="absolute top-full left-0 right-0 mt-1 bg-surface-200 border border-surface-300 rounded shadow-xl z-50 max-h-80 overflow-y-auto">
        <button
          v-for="r in searchResults.slice(0, 10)"
          :key="r.symbol"
          @click="selectResult(r)"
          class="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-surface-300 text-left border-b border-surface-300/40 last:border-0"
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

    <!-- Auth + Refresh -->
    <div class="flex items-center gap-2 flex-shrink-0">
      <div v-if="authStore.firebaseEnabled" class="relative">
        <button
          v-if="!authStore.isLoggedIn"
          @click="showAuth = true"
          class="text-xs font-mono px-2.5 py-1 rounded text-gray-400 hover:text-accent border border-surface-300 hover:border-accent/40 transition-colors"
        >
          Sign in
        </button>
        <div v-else class="flex items-center gap-2 relative" @click.stop>
          <span v-if="authStore.syncing" class="text-[10px] text-gray-600 font-mono animate-pulse">Syncing…</span>
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
              Sign out
            </button>
          </div>
        </div>
      </div>
      <button
        @click="refresh"
        :class="refreshing ? 'animate-spin' : ''"
        class="text-gray-400 hover:text-accent transition-colors"
        title="Refresh"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
      </button>
    </div>

    <AuthModal :open="showAuth" @close="showAuth = false" />
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMarketStore } from '../../stores/marketStore.js';
import { useNewsStore } from '../../stores/newsStore.js';
import { useScannerStore } from '../../stores/scannerStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import AuthModal from '../auth/AuthModal.vue';

const route = useRoute();
const router = useRouter();
const marketStore = useMarketStore();
const newsStore = useNewsStore();
const scannerStore = useScannerStore();
const authStore = useAuthStore();

const searchQuery = ref('');
const refreshing = ref(false);
const showAuth = ref(false);
const userMenuOpen = ref(false);

function onDocClick() {
  userMenuOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

async function signOut() {
  userMenuOpen.value = false;
  await authStore.logout();
}

const searchResults = computed(() => marketStore.searchResults);

let searchTimer;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => marketStore.searchSymbol(searchQuery.value), 300);
}

function clearSearch() {
  searchQuery.value = '';
  marketStore.searchResults = [];
}

async function selectResult(r) {
  clearSearch();
  router.push({ name: 'stock', params: { symbol: r.symbol } });
}

async function refresh() {
  if (refreshing.value) return;
  refreshing.value = true;
  await Promise.allSettled([
    marketStore.fetchWatchlist(),
    route.name === 'news' ? newsStore.fetchMarketNews() : Promise.resolve(),
    route.name === 'opportunities' ? scannerStore.refresh() : Promise.resolve()
  ]);
  setTimeout(() => { refreshing.value = false; }, 800);
}
</script>
