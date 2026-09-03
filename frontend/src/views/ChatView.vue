<template>
  <div class="flex flex-col h-full bg-surface overflow-hidden">
    <div class="flex-shrink-0 px-3 sm:px-4 py-2.5 border-b border-surface-300 flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <h1 class="text-sm font-mono text-white tracking-tight">{{ $t('chat.title') }}</h1>
        <p class="text-[11px] text-gray-500 font-mono truncate">{{ $t('chat.emptyHint') }}</p>
      </div>
      <div v-if="chat.focusSymbol" class="flex items-center rounded border border-accent/40 overflow-hidden">
        <button
          type="button"
          class="text-[11px] font-mono px-2 py-1 text-accent hover:bg-accent/10"
          @click="openSymbol"
        >{{ $t('chat.context', { symbol: chat.focusSymbol }) }}</button>
        <button
          type="button"
          class="px-1.5 py-1 text-accent/70 hover:text-white border-l border-accent/30"
          :aria-label="$t('chat.clearContext')"
          @click="chat.setFocus(null)"
        >×</button>
      </div>
      <button
        v-else-if="market.selectedSymbol"
        type="button"
        class="text-[11px] font-mono px-2 py-1 rounded border border-surface-300 text-gray-400 hover:text-accent hover:border-accent/40"
        @click="chat.setFocus(market.selectedSymbol)"
      >{{ $t('chat.attach', { symbol: market.selectedSymbol }) }}</button>
      <button
        type="button"
        class="text-[11px] font-mono px-2 py-1 rounded border border-surface-300 text-gray-400 hover:text-white"
        @click="chat.clear()"
      >{{ $t('chat.newChat') }}</button>
    </div>

    <div ref="scroller" class="flex-1 min-h-0 overflow-y-auto panel-scroll px-3 sm:px-4">
      <div class="max-w-3xl mx-auto py-4 space-y-3">
        <div v-if="!chat.messages.length" class="space-y-3 pt-4">
          <p class="text-sm text-gray-300 leading-relaxed">{{ $t('chat.empty') }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="item in suggestions"
              :key="item.id"
              type="button"
              class="text-xs font-mono px-2.5 py-1.5 rounded-lg border border-surface-300 text-gray-400 hover:text-accent hover:border-accent/40 text-left"
              @click="ask(item.text)"
            >{{ item.text }}</button>
          </div>
        </div>

        <article
          v-for="msg in chat.messages"
          :key="msg.id"
          class="rounded-lg px-3 py-2.5"
          :class="msg.role === 'user' ? 'bg-surface-200/80 ml-6 sm:ml-16' : 'card mr-4 sm:mr-12'"
        >
          <p class="text-[10px] font-mono uppercase tracking-wide mb-1" :class="msg.role === 'user' ? 'text-gray-500' : 'text-accent'">
            {{ msg.role === 'user' ? $t('chat.you') : $t('chat.desk') }}
          </p>
          <p class="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{{ msg.content }}</p>
          <p v-if="msg.pending && !msg.content" class="text-xs font-mono text-gray-500">{{ phaseLabel }}</p>
          <div v-if="msg.sources?.length" class="mt-3 pt-2 border-t border-surface-300/50">
            <p class="text-[10px] font-mono text-gray-500 uppercase tracking-wide mb-1.5">
              {{ msg.searched ? $t('chat.searched') : $t('chat.sources') }}
            </p>
            <SourceList :items="sourceItems(msg.sources)" compact />
          </div>
        </article>

        <p v-if="chat.error" class="text-xs font-mono text-bear">{{ chat.error }}</p>
        <p v-if="ollamaOff" class="text-xs font-mono text-gray-500">{{ $t('chat.offline') }}</p>
      </div>
    </div>

    <form class="flex-shrink-0 border-t border-surface-300 px-3 sm:px-4 py-2.5" @submit.prevent="submit">
      <div class="max-w-3xl mx-auto">
        <div class="flex items-end gap-2">
          <textarea
            ref="box"
            v-model="draft"
            rows="2"
            :placeholder="$t('chat.placeholder')"
            class="flex-1 bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent/50 resize-none font-sans"
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
        </div>
        <p class="mt-1.5 text-[10px] font-mono text-gray-600">{{ $t('chat.disclaimer') }}</p>
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import SourceList from '../components/news/SourceList.vue';
import { useChatStore } from '../stores/chatStore.js';
import { useMarketStore } from '../stores/marketStore.js';
import { useUiStore } from '../stores/uiStore.js';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const chat = useChatStore();
const market = useMarketStore();
const ui = useUiStore();
const draft = ref('');
const scroller = ref(null);
const box = ref(null);

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

const suggestions = computed(() => {
  const sym = chat.focusSymbol || market.selectedSymbol;
  const items = [];
  if (sym) items.push({ id: 'move', text: t('chat.suggestions.move', { symbol: sym }) });
  items.push(
    { id: 'market', text: t('chat.suggestions.market') },
    { id: 'pe', text: t('chat.suggestions.pe') },
    { id: 'earnings', text: t('chat.suggestions.earnings') }
  );
  return items;
});

function sourceItems(list) {
  return (list || []).map(s => ({
    title: s.title,
    url: s.url,
    summary: s.summary || ''
  }));
}

function openSymbol() {
  if (chat.focusSymbol) router.push({ name: 'stock', params: { symbol: chat.focusSymbol } });
}

function ask(text) {
  draft.value = text;
  submit();
}

function submit() {
  const text = draft.value.trim();
  if (!text || chat.sending) return;
  draft.value = '';
  chat.send(text, { simple: ui.isSimple });
}

function scrollBottom() {
  nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(() => route.query.symbol, (sym) => {
  if (sym) chat.setFocus(String(sym).toUpperCase());
}, { immediate: true });

watch(() => chat.messages.map(m => `${m.content}${m.pending}`), scrollBottom);
watch(() => chat.phase, scrollBottom);

onMounted(() => {
  box.value?.focus();
  scrollBottom();
});
</script>
