import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { healthApi } from '../services/api.js';

const MODE_KEY = 'financially.deskMode';

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'pro' ? 'pro' : 'simple';
  } catch {
    return 'simple';
  }
}

export const useUiStore = defineStore('ui', () => {
  const backendDown = ref(false);
  const health = ref(null);
  const toasts = ref([]);
  const commandOpen = ref(false);
  const deskMode = ref(readMode());
  const isPro = computed(() => deskMode.value === 'pro');
  const isSimple = computed(() => deskMode.value === 'simple');
  let toastId = 0;

  function setDeskMode(mode) {
    deskMode.value = mode === 'pro' ? 'pro' : 'simple';
    try { localStorage.setItem(MODE_KEY, deskMode.value); } catch { /* ignore */ }
  }

  function toast(message, type = 'info') {
    const id = ++toastId;
    toasts.value = [...toasts.value, { id, message, type }];
    setTimeout(() => {
      toasts.value = toasts.value.filter(t => t.id !== id);
    }, 4200);
  }

  function dismiss(id) {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  async function checkHealth() {
    try {
      const res = await healthApi.check();
      health.value = res.data;
      backendDown.value = false;
      return true;
    } catch {
      backendDown.value = true;
      return false;
    }
  }

  return {
    backendDown, health, toasts, commandOpen, deskMode, isPro, isSimple,
    toast, dismiss, checkHealth, setDeskMode
  };
});
