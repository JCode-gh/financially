<template>
  <article
    class="p-2.5 border-b border-surface-300/50 hover:bg-surface-200/50 cursor-pointer transition-colors group"
    @click="open"
  >
    <div class="flex items-start gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 mb-1">
          <span :class="sentimentClass" class="text-xs px-1.5 py-0.5 rounded font-mono font-medium flex-shrink-0">
            {{ sentimentIcon }} {{ article.sentiment?.label || 'neutral' }}
          </span>
          <span class="text-gray-500 text-xs truncate font-mono">{{ article.source }}</span>
          <span class="text-gray-600 text-xs flex-shrink-0 ml-auto">{{ timeAgo }}</span>
        </div>
        <p class="text-gray-200 text-xs leading-snug group-hover:text-white transition-colors line-clamp-2">
          {{ article.headline }}
        </p>
        <p v-if="article.summary" class="text-gray-500 text-xs mt-1 line-clamp-1">
          {{ article.summary }}
        </p>
        <!-- Detected market-moving events -->
        <div v-if="article.events?.length" class="flex flex-wrap gap-1 mt-1">
          <span
            v-for="ev in article.events.slice(0, 3)"
            :key="ev.id"
            class="text-[9px] font-mono px-1 py-px rounded border leading-tight"
            :class="ev.impact >= 0 ? 'bg-bull/10 text-bull border-bull/20' : 'bg-bear/10 text-bear border-bear/20'"
          >{{ ev.label }}</span>
        </div>
      </div>
    </div>

    <!-- Sentiment score bar -->
    <div class="mt-2 flex items-center gap-2">
      <div class="flex-1 h-0.5 bg-surface-300 rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="score >= 0 ? 'bg-bull' : 'bg-bear'"
          :style="{ width: Math.abs(score * 100) + '%', marginLeft: score >= 0 ? '50%' : `${50 + score * 50}%` }"
        ></div>
      </div>
      <span class="text-xs font-mono" :class="score > 0.1 ? 'text-bull' : score < -0.1 ? 'text-bear' : 'text-gray-500'">
        {{ (score * 100).toFixed(0) }}
      </span>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  article: { type: Object, required: true }
});

const score = computed(() => props.article.sentiment?.score || 0);

const sentimentClass = computed(() => {
  const label = props.article.sentiment?.label;
  if (label === 'bullish') return 'bg-bull/10 text-bull border border-bull/20';
  if (label === 'bearish') return 'bg-bear/10 text-bear border border-bear/20';
  return 'bg-gray-500/10 text-gray-400 border border-gray-500/20';
});

const sentimentIcon = computed(() => {
  const label = props.article.sentiment?.label;
  if (label === 'bullish') return '▲';
  if (label === 'bearish') return '▼';
  return '●';
});

const timeAgo = computed(() => {
  const now = new Date();
  const pub = new Date(props.article.publishedAt);
  const diffMs = now - pub;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
});

function open() {
  if (props.article.url) window.open(props.article.url, '_blank', 'noopener,noreferrer');
}
</script>
