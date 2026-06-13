import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { predictionsApi } from '../services/api.js';

export const usePredictionStore = defineStore('predictions', () => {
  const accuracy = ref(null);
  const currentPrediction = ref(null);
  const predictionHistory = ref([]);
  const tradeSetup = ref(null);
  const loading = ref({ accuracy: false, generating: false, history: false, tradeSetup: false });
  const generating = ref(false);

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
    } catch { /* silently fail */ }
    finally { loading.value.accuracy = false; }
  }

  async function generateForSymbol(symbol) {
    generating.value = true;
    loading.value.generating = true;
    try {
      const res = await predictionsApi.generate(symbol);
      currentPrediction.value = res.data.data;
      return res.data.data;
    } catch (e) {
      throw e;
    } finally {
      generating.value = false;
      loading.value.generating = false;
    }
  }

  async function fetchForSymbol(symbol) {
    try {
      const res = await predictionsApi.forSymbol(symbol);
      const data = res.data.data;
      // Merge active predictions into currentPrediction shape
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
    loading.value.tradeSetup = true;
    tradeSetup.value = null;
    try {
      const res = await predictionsApi.tradeSetup(symbol, maxDays);
      tradeSetup.value = res.data.data;
      return res.data.data;
    } catch (e) {
      throw e;
    } finally {
      loading.value.tradeSetup = false;
    }
  }

  return {
    accuracy, currentPrediction, predictionHistory, tradeSetup, loading, generating,
    overallAccuracy, modelHealth,
    fetchAccuracy, generateForSymbol, fetchForSymbol, fetchHistory, generateTradeSetup
  };
});
