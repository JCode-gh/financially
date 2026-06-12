import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'firebase/auth';
import { auth, firebaseEnabled } from '../firebase.js';
import { loadCloudUserData, saveCloudUserData } from '../services/userDataSync.js';

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const loading = ref(firebaseEnabled);
  const error = ref(null);
  const syncing = ref(false);

  const isLoggedIn = computed(() => !!user.value);
  const displayName = computed(() =>
    user.value?.displayName || user.value?.email?.split('@')[0] || 'Account'
  );

  async function applyCloudData(cloud) {
    const { useMarketStore } = await import('./marketStore.js');
    const market = useMarketStore();
    if (cloud?.watchlists?.lists?.length) {
      market.hydrateUserData(cloud);
    }
  }

  async function uploadLocalData(uid) {
    const { useMarketStore } = await import('./marketStore.js');
    const market = useMarketStore();
    await saveCloudUserData(uid, market.exportUserData());
  }

  async function handleAuthUser(fbUser) {
    user.value = fbUser;
    if (!fbUser) return;

    syncing.value = true;
    try {
      // Ensure auth token is ready before Firestore reads/writes
      await fbUser.getIdToken(true);
      const cloud = await loadCloudUserData(fbUser.uid);
      if (cloud?.watchlists?.lists?.length) {
        await applyCloudData(cloud);
      } else {
        await uploadLocalData(fbUser.uid);
      }
    } catch (e) {
      const msg = e?.code || e?.message || String(e);
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        console.warn('[auth] Firestore sync skipped — deploy firestore.rules and add your site to Firebase Authorized domains');
      } else {
        console.warn('[auth] cloud sync failed:', msg);
      }
      // Don't block the app — local watchlists still work offline
    } finally {
      syncing.value = false;
    }
  }

  function init() {
    if (!firebaseEnabled) {
      loading.value = false;
      return;
    }
    onAuthStateChanged(auth, async (fbUser) => {
      loading.value = true;
      error.value = null;
      try {
        if (fbUser) await handleAuthUser(fbUser);
        else user.value = null;
      } finally {
        loading.value = false;
      }
    });
  }

  async function register(email, password, displayNameInput) {
    if (!firebaseEnabled) throw new Error('Firebase is not configured');
    error.value = null;
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const name = displayNameInput?.trim();
    if (name) await updateProfile(cred.user, { displayName: name });
    return cred.user;
  }

  async function login(email, password) {
    if (!firebaseEnabled) throw new Error('Firebase is not configured');
    error.value = null;
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return cred.user;
  }

  async function logout() {
    if (!firebaseEnabled) return;
    error.value = null;
    await signOut(auth);
  }

  function clearError() {
    error.value = null;
  }

  return {
    user, loading, error, syncing, isLoggedIn, displayName,
    init, register, login, logout, clearError, firebaseEnabled
  };
});
