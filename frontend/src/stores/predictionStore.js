import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { predictionsApi, streamGeneratePrediction } from '../services/api.js';
import { previewFromQwenStream } from '../utils/qwenPreview.js';
import { currentLocale, t } from '../i18n/index.js';

const STYLE_KEY = 'financially.briefStyle';
const STYLES = ['desk', 'plain', 'skeptic', 'detailed'];

function readStyle() {
  try {
    const s = localStorage.getItem(STYLE_KEY);
    return STYLES.includes(s) ? s : 'desk';
  } catch {
    return 'desk';
  }
}

export const usePredictionStore = defineStore('predictions', () => {
  const accuracy = ref(null);
  const currentPrediction = ref(null);
  const byTicker = ref({});
  const predictionHistory = ref([]);
  const tradeSetup = ref(null);
  const briefStyle = ref(readStyle());
  const briefNotes = ref('');
  const loading = ref({ accuracy: false, generating: false, history: false, tradeSetup: false });
  const generating = ref(false);
  const generatingPhase = ref('');
  const generatingPreview = ref('');
  const generatingRaw = ref('');
  const error = ref(null);
  let genReqId = 0;
  let genAbort = null;
  let setupReqId = 0;

  const PHASE_KEYS = {
    tape: 'verdict.analyzingTape',
    news: 'verdict.analyzingNews',
    world: 'verdict.analyzingWorld',
    model: 'verdict.analyzingModel'
  };

  function setBriefStyle(style) {
    briefStyle.value = STYLES.includes(style) ? style : 'desk';
    try { localStorage.setItem(STYLE_KEY, briefStyle.value); } catch { /* ignore */ }
  }

  function setBriefNotes(notes) {
    briefNotes.value = String(notes || '').slice(0, 400);
  }

  function clearBriefNotes() {
    briefNotes.value = '';
  }

  const overallAccuracy = computed(() => {
    if (!accuracy.value?.horizons) return null;
    const h1d = accuracy.value.horizons.find(h => h.horizon === '1d');
    return h1d ? (h1d.accuracy * 100).toFixed(1) : null;
  });

  const modelHealth = computed(() => {
    if (!accuracy.value) return 'unknown';
    const iter = accuracy.value.modelIteration || 0;
    if (iter < 10) return 'learning';
    const acc = parseFloat(overallAccuracy.value);
    if (acc >= 65) return 'excellent';
    if (acc >= 55) return 'good';
    if (acc >= 45) return 'fair';
    return 'poor';
  });

  async function fetchAccuracy() {
    loading.value.accuracy = true;
    try {
      const res = await predictionsApi.accuracy();
      accuracy.value = res.data.data;
    } catch { /* keep previous */ }
    finally { loading.value.accuracy = false; }
  }

  async function generateForSymbol(symbol, name, { force, style, notes } = {}) {
    const key = String(symbol || '').toUpperCase();
    if (!key) return null;
    const reqId = ++genReqId;
    const locale = currentLocale();
    const nextStyle = style || briefStyle.value;
    const nextNotes = notes != null ? notes : briefNotes.value;
    const cached = byTicker.value[key];
    const sameBrief = cached?._style === nextStyle && cached?._notes === String(nextNotes || '').trim();
    const cacheOk = cached && cached._lang === locale && sameBrief;
    if (cacheOk) currentPrediction.value = cached;
    generating.value = !cacheOk || !!force;
    loading.value.generating = generating.value;
    generatingPhase.value = '';
    generatingPreview.value = '';
    generatingRaw.value = '';
    error.value = null;
    genAbort?.abort();
    genAbort = new AbortController();
    try {
      const data = await streamGeneratePrediction({
        symbol,
        name,
        force,
        style: nextStyle,
        notes: nextNotes,
        lang: locale,
        signal: genAbort.signal,
        onEvent(evt) {
          if (reqId !== genReqId) return;
          if (evt.type === 'status') {
            generatingPhase.value = PHASE_KEYS[evt.phase] || '';
          }
          if (evt.type === 'token') {
            generatingRaw.value += evt.text || '';
            generatingPreview.value = previewFromQwenStream(generatingRaw.value);
          }
        }
      });
      if (reqId !== genReqId) return null;
      const packed = {
        ...data,
        _at: Date.now(),
        _lang: locale,
        _style: nextStyle,
        _notes: String(nextNotes || '').trim()
      };
      byTicker.value = { ...byTicker.value, [key]: packed };
      currentPrediction.value = packed;
      return packed;
    } catch (e) {
      if (reqId === genReqId && e?.name !== 'AbortError') {
        error.value = e.normalized?.message || t('errors.predictionFailed');
        throw e;
      }
    } finally {
      if (reqId === genReqId) {
        generating.value = false;
        loading.value.generating = false;
        generatingPhase.value = '';
        generatingPreview.value = '';
        generatingRaw.value = '';
        genAbort = null;
      }
    }
  }

  async function fetchForSymbol(symbol) {
    try {
      const res = await predictionsApi.forSymbol(symbol);
      const data = res.data.data;
      if (data.active && data.active.length > 0) {
        currentPrediction.value = {
          ticker: symbol,
          predictions: data.active,
          signals: data.active[0]?.signals || {},
          indicators: null,
          weights: data.active[0]?.weights_used || {}
        };
      }
      predictionHistory.value = data.history || [];
    } catch { /* fail silently */ }
  }

  async function fetchHistory(params) {
    loading.value.history = true;
    try {
      const res = await predictionsApi.history(params);
      predictionHistory.value = res.data.data || [];
    } catch { predictionHistory.value = []; }
    finally { loading.value.history = false; }
  }

  async function generateTradeSetup(symbol, maxDays) {
    const reqId = ++setupReqId;
    loading.value.tradeSetup = true;
    tradeSetup.value = null;
    try {
      const res = await predictionsApi.tradeSetup(symbol, maxDays);
      if (reqId !== setupReqId) return null;
      tradeSetup.value = res.data.data;
      return res.data.data;
    } catch (e) {
      if (reqId === setupReqId) throw e;
    } finally {
      if (reqId === setupReqId) loading.value.tradeSetup = false;
    }
  }

  return {
    accuracy, currentPrediction, byTicker, predictionHistory, tradeSetup,
    briefStyle, briefNotes, loading, generating, generatingPhase, generatingPreview, error,
    overallAccuracy, modelHealth,
    setBriefStyle, setBriefNotes, clearBriefNotes,
    fetchAccuracy, generateForSymbol, fetchForSymbol, fetchHistory, generateTradeSetup
  };
});
