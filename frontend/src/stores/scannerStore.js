import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { scannerApi } from '../services/api.js';

export const useScannerStore = defineStore('scanner', () => {
  const opportunities = ref([]);
  const runAt = ref(null);
  const meta = ref(null);
  const alerts = ref([]);
  const earnings = ref({});
  const loading = ref({ scan: false, running: false, alerts: false });

  const actionable = computed(() => opportunities.value.filter(o => o.actionable));
  const watchlist = computed(() => opportunities.value.filter(o => o.quality === 'watch'));
  const buys = computed(() => opportunities.value.filter(o => o.action === 'BUY'));
  const sells = computed(() => opportunities.value.filter(o => o.action === 'SELL'));

  const lastScanAgo = computed(() => {
    if (!runAt.value) return null;
    // SQLite CURRENT_TIMESTAMP is UTC without timezone suffix
    const iso = String(runAt.value).includes('T') ? runAt.value : runAt.value.replace(' ', 'T') + 'Z';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (isNaN(mins)) return null;
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  });

  async function fetchLatest() {
    loading.value.scan = true;
    try {
      const res = await scannerApi.latest();
      const data = res.data.data;
      opportunities.value = data.results || [];
      runAt.value = data.runAt;
      meta.value = data.meta || null;
    } catch { /* keep previous */ }
    finally { loading.value.scan = false; }
  }

  async function runScan() {
    if (loading.value.running) return;
    loading.value.running = true;
    try {
      const res = await scannerApi.run();
      const data = res.data.data;
      opportunities.value = data.results || [];
      runAt.value = data.runAt;
      meta.value = data.meta || null;
      await fetchAlerts();
    } catch { /* keep previous */ }
    finally { loading.value.running = false; }
  }

  async function fetchAlerts() {
    loading.value.alerts = true;
    try {
      const res = await scannerApi.alerts(30);
      alerts.value = res.data.data || [];
    } catch { /* keep previous */ }
    finally { loading.value.alerts = false; }
  }

  async function fetchEarnings() {
    try {
      const res = await scannerApi.earnings();
      earnings.value = res.data.data || {};
    } catch { /* keep previous */ }
  }

  async function init() {
    await Promise.allSettled([fetchLatest(), fetchAlerts(), fetchEarnings()]);
    if (!opportunities.value.length) {
      runScan();
    }
  }

  async function refresh() {
    await Promise.allSettled([fetchLatest(), fetchAlerts()]);
  }

  return {
    opportunities, runAt, meta, alerts, earnings, loading,
    actionable, watchlist, buys, sells, lastScanAgo,
    fetchLatest, runScan, fetchAlerts, fetchEarnings, init, refresh
  };
});
