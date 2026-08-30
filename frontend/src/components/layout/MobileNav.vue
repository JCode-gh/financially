<template>
  <nav
    class="lg:hidden flex-shrink-0 bg-surface-100 border-t border-surface-300 grid grid-cols-4"
    style="padding-bottom: env(safe-area-inset-bottom)"
    :aria-label="$t('nav.menu')"
  >
    <RouterLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-mono"
      :class="isActive(link) ? 'text-accent' : 'text-gray-500'"
    >
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
        <template v-if="link.name === 'dashboard'">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </template>
        <path v-else-if="link.name === 'stocks'" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        <path v-else-if="link.name === 'opportunities'" d="M12 2l2.4 7.2H22l-6 4.8 2.3 7.2L12 16.4 5.7 21.2 8 14 2 9.2h7.6z" />
        <template v-else-if="link.name === 'news'">
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="13" y2="16" />
        </template>
      </svg>
      {{ link.label }}
    </RouterLink>
  </nav>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

const { t } = useI18n();
const route = useRoute();

const links = computed(() => [
  { to: '/', name: 'dashboard', extra: [], label: t('nav.terminal') },
  { to: '/watchlist', name: 'stocks', extra: ['stock'], label: t('nav.watchlist') },
  { to: '/opportunities', name: 'opportunities', extra: [], label: t('nav.picks') },
  { to: '/news', name: 'news', extra: [], label: t('nav.news') }
]);

function isActive(link) {
  return route.name === link.name || link.extra.includes(route.name);
}
</script>
