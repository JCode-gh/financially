import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { predictionsApi } from '../services/api.js';
import { currentLocale, t } from '../i18n/index.js';

export const usePredictionStore = defineStore('predictions', () => {
  const accuracy = ref(null);
  const currentPrediction = ref(null);
  const byTicker = ref({});
  const predictionHistory = ref([]);
  const tradeSetup = ref(null);
  const loading = ref({ accuracy: false, generating: false, history: false, tradeSetup: false });
  const generating = ref(false);
  const error = ref(null);
  let genReqId = 0;
  let setupReqId = 0;

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

  async function generateForSymbol(symbol, name, { force } = {}) {
    const key = String(symbol || '').toUpperCase();
    if (!key) return null;
    const reqId = ++genReqId;
    const locale = currentLocale();
    const cached = byTicker.value[key];
    const cacheOk = cached && cached._lang === locale;
    if (cacheOk) currentPrediction.value = cached;
    generating.value = !cacheOk || !!force;
    loading.value.generating = generating.value;
    error.value = null;
    try {
      const res = await predictionsApi.generate(symbol, name, { force });
      if (reqId !== genReqId) return null;
      const data = { ...res.data.data, _at: Date.now(), _lang: locale };
      byTicker.value = { ...byTicker.value, [key]: data };
      currentPrediction.value = data;
      return data;
    } catch (e) {
      if (reqId === genReqId) {
        error.value = e.normalized?.message || t('errors.predictionFailed');
        throw e;
      }
    } finally {
      if (reqId === genReqId) {
        generating.value = false;
        loading.value.generating = false;
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
    accuracy, currentPrediction, byTicker, predictionHistory, tradeSetup, loading, generating, error,
    overallAccuracy, modelHealth,
    fetchAccuracy, generateForSymbol, fetchForSymbol, fetchHistory, generateTradeSetup
  };
});
