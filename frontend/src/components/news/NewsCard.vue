<template>
  <article
    class="px-3 py-2.5 border-b border-surface-300/40 hover:bg-surface-200/40 cursor-pointer transition-colors group"
    @click="open"
  >
    <div class="flex items-start gap-2">
      <span class="flex-shrink-0 mt-0.5 text-xs" :class="toneClass">{{ sentimentIcon }}</span>
      <div class="flex-1 min-w-0">
        <p class="text-[13px] text-gray-200 leading-snug group-hover:text-white line-clamp-2">
          {{ article.headline }}
        </p>
        <div class="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-gray-600">
          <span
            v-for="sym in (article.matchedSymbols || []).slice(0, 2)"
            :key="sym"
            class="text-accent"
          >{{ sym }}</span>
          <span class="truncate">{{ article.source }}</span>
          <span
            v-if="article.events?.[0]"
            class="truncate"
            :class="article.events[0].impact >= 0 ? 'text-bull' : 'text-bear'"
          >{{ article.events[0].label }}</span>
          <span class="ml-auto flex-shrink-0">{{ timeAgo }}</span>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps({
  article: { type: Object, required: true }
});

const sentimentIcon = computed(() => {
  const label = props.article.sentiment?.label;
  if (label === 'bullish') return '▲';
  if (label === 'bearish') return '▼';
  return '●';
});

const toneClass = computed(() => {
  const label = props.article.sentiment?.label;
  if (label === 'bullish') return 'text-bull';
  if (label === 'bearish') return 'text-bear';
  return 'text-gray-600';
});

const timeAgo = computed(() => {
  const pub = new Date(props.article.publishedAt);
  const diffMins = Math.floor((Date.now() - pub) / 60000);
  if (diffMins < 1) return t('time.now');
  if (diffMins < 60) return t('time.minutesShort', { n: diffMins });
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return t('time.hoursShort', { n: hours });
  return t('time.daysShort', { n: Math.floor(hours / 24) });
});

function open() {
  if (props.article.url) window.open(props.article.url, '_blank', 'noopener,noreferrer');
}
</script>
