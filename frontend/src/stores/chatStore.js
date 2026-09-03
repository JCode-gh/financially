import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { streamDeskChat } from '../services/api.js';
import { readLocale } from '../i18n/locale.js';
import { t } from '../i18n/index.js';

const STORE_KEY = 'financially.chat.v2';
const LEGACY_KEY = 'financially.chat.v1';
const MAX_THREADS = 40;
const MAX_MESSAGES = 40;

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function titleFrom(messages, focusSymbol) {
  const first = (messages || []).find(m => m.role === 'user' && m.content);
  const text = String(first?.content || '').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 72);
  return focusSymbol || '';
}

function cleanMessages(list) {
  return (list || [])
    .filter(m => m?.role && m?.content && !m.pending)
    .map(m => ({
      id: m.id || newId('m'),
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content),
      sources: Array.isArray(m.sources) ? m.sources : [],
      searched: !!m.searched
    }))
    .slice(-MAX_MESSAGES);
}

function stamp(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return String(value);
}

function makeThread({ messages = [], focusSymbol = null, id, createdAt, updatedAt } = {}) {
  const cleaned = cleanMessages(messages);
  return {
    id: id || newId('c'),
    title: titleFrom(cleaned, focusSymbol),
    focusSymbol: focusSymbol || null,
    messages: cleaned,
    createdAt: stamp(createdAt),
    updatedAt: stamp(updatedAt)
  };
}

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && Array.isArray(raw.threads)) {
      const threads = raw.threads.map(t => makeThread(t)).filter(t => t.messages.length);
      const activeId = threads.some(t => t.id === raw.activeId) ? raw.activeId : (threads[0]?.id || null);
      return { threads, activeId };
    }
  } catch { /* fall through */ }

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy?.messages?.length) {
      const thread = makeThread({
        messages: legacy.messages,
        focusSymbol: legacy.focusSymbol || null
      });
      return { threads: [thread], activeId: thread.id };
    }
  } catch { /* ignore */ }

  return { threads: [], activeId: null };
}

export const useChatStore = defineStore('chat', () => {
  const saved = loadSaved();
  const threads = ref(saved.threads);
  const activeId = ref(saved.activeId);
  const messages = ref(
    (saved.threads.find(t => t.id === saved.activeId)?.messages || []).map(m => ({ ...m }))
  );
  const focusSymbol = ref(
    saved.threads.find(t => t.id === saved.activeId)?.focusSymbol || null
  );
  const sending = ref(false);
  const phase = ref('');
  const error = ref('');
  let abort = null;
  let reqId = 0;

  const history = computed(() =>
    [...threads.value].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
  );

  function persist() {
    const existing = threads.value.find(t => t.id === activeId.value);
    let nextThreads = threads.value;
    if (messages.value.some(m => m.content && !m.pending)) {
      const snapshot = makeThread({
        id: activeId.value || newId('c'),
        messages: messages.value,
        focusSymbol: focusSymbol.value,
        createdAt: existing?.createdAt,
        updatedAt: new Date().toISOString()
      });
      if (!activeId.value) activeId.value = snapshot.id;
      nextThreads = [snapshot, ...threads.value.filter(t => t.id !== snapshot.id)];
    }
    threads.value = nextThreads.slice(0, MAX_THREADS);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        threads: threads.value,
        activeId: activeId.value
      }));
    } catch { /* ignore */ }
  }

  function setFocus(symbol) {
    focusSymbol.value = String(symbol || '').trim().toUpperCase() || null;
    persist();
  }

  function startNew() {
    if (abort) abort.abort();
    persist();
    activeId.value = null;
    messages.value = [];
    error.value = '';
    phase.value = '';
    sending.value = false;
  }

  function openThread(id) {
    if (!id || id === activeId.value) return;
    if (sending.value) return;
    persist();
    const thread = threads.value.find(t => t.id === id);
    if (!thread) return;
    activeId.value = thread.id;
    messages.value = thread.messages.map(m => ({ ...m }));
    focusSymbol.value = thread.focusSymbol || null;
    error.value = '';
    phase.value = '';
  }

  function removeThread(id) {
    threads.value = threads.value.filter(t => t.id !== id);
    if (activeId.value === id) {
      const next = threads.value[0];
      activeId.value = next?.id || null;
      messages.value = next ? next.messages.map(m => ({ ...m })) : [];
      focusSymbol.value = next?.focusSymbol || null;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        threads: threads.value,
        activeId: activeId.value
      }));
    } catch { /* ignore */ }
  }

  function stop() {
    if (abort) abort.abort();
  }

  async function send(text, { simple, watchlist } = {}) {
    const content = String(text || '').trim();
    if (!content || sending.value) return;
    error.value = '';
    const id = ++reqId;
    abort = new AbortController();
    sending.value = true;
    phase.value = 'reading';

    if (!activeId.value) activeId.value = newId('c');

    messages.value = [
      ...messages.value,
      { id: newId('m'), role: 'user', content },
      { id: newId('m'), role: 'assistant', content: '', pending: true, sources: [], searched: false }
    ];

    const outbound = messages.value
      .filter(m => !m.pending || m.role === 'user')
      .filter(m => m.content)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      await streamDeskChat({
        messages: outbound,
        symbol: focusSymbol.value,
        watchlist,
        simple,
        lang: readLocale(),
        signal: abort.signal,
        onEvent(evt) {
          if (id !== reqId) return;
          if (evt.type === 'status') phase.value = evt.phase || '';
          if (evt.type === 'token') {
            const last = messages.value[messages.value.length - 1];
            if (last?.role === 'assistant') {
              last.content += evt.text;
              last.pending = true;
            }
          }
          if (evt.type === 'done') {
            const last = messages.value[messages.value.length - 1];
            if (last?.role === 'assistant') {
              last.pending = false;
              last.sources = evt.sources || [];
              last.searched = !!evt.searched;
            }
          }
        }
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        const last = messages.value[messages.value.length - 1];
        if (last?.role === 'assistant' && last.pending) {
          if (!last.content) messages.value = messages.value.slice(0, -2);
          else last.pending = false;
        }
      } else {
        error.value = err?.normalized?.message || err.message || t('chat.failed');
        const last = messages.value[messages.value.length - 1];
        if (last?.role === 'assistant' && last.pending && !last.content) {
          messages.value = messages.value.slice(0, -1);
        } else if (last?.role === 'assistant') {
          last.pending = false;
        }
      }
    } finally {
      if (id === reqId) {
        sending.value = false;
        phase.value = '';
        abort = null;
        persist();
      }
    }
  }

  return {
    messages, focusSymbol, sending, phase, error, threads, activeId, history,
    setFocus, startNew, openThread, removeThread, stop, send,
    clear: startNew
  };
});
