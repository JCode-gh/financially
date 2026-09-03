import { defineStore } from 'pinia';
import { ref } from 'vue';
import { streamDeskChat } from '../services/api.js';
import { readLocale } from '../i18n/locale.js';
import { t } from '../i18n/index.js';

const STORE_KEY = 'financially.chat.v1';

function newId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function loadSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!raw || !Array.isArray(raw.messages)) return { messages: [], focusSymbol: null };
    return {
      messages: raw.messages.filter(m => m?.role && m?.content).slice(-40),
      focusSymbol: raw.focusSymbol || null
    };
  } catch {
    return { messages: [], focusSymbol: null };
  }
}

export const useChatStore = defineStore('chat', () => {
  const saved = loadSaved();
  const messages = ref(saved.messages);
  const focusSymbol = ref(saved.focusSymbol);
  const sending = ref(false);
  const phase = ref('');
  const error = ref('');
  let abort = null;
  let reqId = 0;

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        messages: messages.value.filter(m => !m.pending).slice(-40),
        focusSymbol: focusSymbol.value
      }));
    } catch { /* ignore */ }
  }

  function setFocus(symbol) {
    const next = String(symbol || '').trim().toUpperCase() || null;
    focusSymbol.value = next;
    persist();
  }

  function clear() {
    if (abort) abort.abort();
    messages.value = [];
    error.value = '';
    phase.value = '';
    sending.value = false;
    persist();
  }

  function stop() {
    if (abort) abort.abort();
  }

  async function send(text, { simple } = {}) {
    const content = String(text || '').trim();
    if (!content || sending.value) return;
    error.value = '';
    const id = ++reqId;
    abort = new AbortController();
    sending.value = true;
    phase.value = 'reading';

    messages.value = [
      ...messages.value,
      { id: newId(), role: 'user', content },
      { id: newId(), role: 'assistant', content: '', pending: true, sources: [], searched: false }
    ];

    const history = messages.value
      .filter(m => !m.pending || m.role === 'user')
      .filter(m => m.content)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      await streamDeskChat({
        messages: history,
        symbol: focusSymbol.value,
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

  return { messages, focusSymbol, sending, phase, error, setFocus, clear, stop, send };
});
