<template>
  <section class="card overflow-hidden">
    <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-surface-300">
      <div class="min-w-0">
        <h2 class="text-sm font-medium text-white">{{ $t('dashboard.askTitle') }}</h2>
        <p class="mt-0.5 text-[11px] font-mono text-gray-500">{{ $t('dashboard.askHint') }}</p>
      </div>
      <RouterLink
        to="/chat"
        class="flex-shrink-0 text-[11px] font-mono text-gray-400 hover:text-accent"
      >{{ $t('dashboard.askOpen') }}</RouterLink>
    </div>

    <div class="px-4 py-3 space-y-3">
      <div v-if="!chat.messages.length" class="flex flex-wrap gap-2">
        <button
          v-for="item in suggestions"
          :key="item.id"
          type="button"
          class="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-surface-300 text-gray-400 hover:text-accent hover:border-accent/40 text-left"
          @click="ask(item.text)"
        >{{ item.text }}</button>
      </div>

      <div
        v-else
        ref="scroller"
        class="max-h-72 overflow-y-auto panel-scroll space-y-2 pr-1"
      >
        <article
          v-for="msg in visibleMessages"
          :key="msg.id"
          class="rounded-lg px-3 py-2.5"
          :class="msg.role === 'user' ? 'bg-surface-200/80' : 'bg-surface-200/40 border border-surface-300/50'"
        >
          <p class="text-[10px] font-mono uppercase tracking-wide mb-1" :class="msg.role === 'user' ? 'text-gray-500' : 'text-accent'">
            {{ msg.role === 'user' ? $t('chat.you') : $t('chat.desk') }}
          </p>
          <p class="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{{ msg.content }}</p>
          <p v-if="msg.pending && !msg.content" class="text-xs font-mono text-gray-500">{{ phaseLabel }}</p>
          <div v-if="msg.sources?.length" class="mt-2 pt-2 border-t border-surface-300/50">
            <SourceList :items="sourceItems(msg.sources)" compact />
          </div>
        </article>
      </div>

      <p v-if="chat.error" class="text-xs font-mono text-bear">{{ chat.error }}</p>
      <p v-if="ollamaOff" class="text-xs font-mono text-gray-500">{{ $t('chat.offline') }}</p>

      <form class="flex items-end gap-2" @submit.prevent="submit">
        <textarea
          v-model="draft"
          rows="2"
          :placeholder="$t('dashboard.askPlaceholder')"
          class="flex-1 bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 resize-none"
          @keydown.enter.exact.prevent="submit"
        />
        <button
          v-if="chat.sending"
          type="button"
          class="text-xs font-mono px-3 py-2 rounded border border-surface-300 text-gray-400 hover:text-white"
          @click="chat.stop()"
        >{{ $t('chat.stop') }}</button>
        <button
          v-else
          type="submit"
          :disabled="!draft.trim() || ui.backendDown"
          class="text-xs font-mono px-3 py-2 rounded border border-accent/50 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent"
        >{{ $t('chat.send') }}</button>
      </form>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import SourceList from '../news/SourceList.vue';
import { useChatStore } from '../../stores/chatStore.js';
import { useMarketStore } from '../../stores/marketStore.js';
import { useUiStore } from '../../stores/uiStore.js';

const { t } = useI18n();
const chat = useChatStore();
const market = useMarketStore();
const ui = useUiStore();
const draft = ref('');
const scroller = ref(null);

const visibleMessages = computed(() => chat.messages.slice(-6));

const ollamaOff = computed(() => {
  if (chat.sending || chat.messages.some(m => m.role === 'assistant' && m.content)) return false;
  return ui.health?.ollama?.ok === false;
});

const phaseLabel = computed(() => {
  const map = {
    reading: 'chat.reading',
    searching: 'chat.searching',
    answering: 'chat.answering'
  };
  return t(map[chat.phase] || 'chat.thinking');
});

const suggestions = computed(() => [
  { id: 'look', text: t('chat.suggestions.portfolio') },
  { id: 'move', text: t('chat.suggestions.portfolioMove') },
  { id: 'sell', text: t('chat.suggestions.portfolioSell') },
  { id: 'earn', text: t('chat.suggestions.portfolioEarn') }
]);

function sourceItems(list) {
  return (list || []).map(s => ({
    title: s.title,
    url: s.url,
    summary: s.summary || ''
  }));
}

function ask(text) {
  draft.value = text;
  submit();
}

function submit() {
  const text = draft.value.trim();
  if (!text || chat.sending) return;
  draft.value = '';
  chat.send(text, {
    simple: ui.isSimple,
    watchlist: market.watchlistSymbols,
    portfolio: true
  });
}

watch(() => chat.messages.map(m => `${m.content}${m.pending}`), () => {
  nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
});
</script>
