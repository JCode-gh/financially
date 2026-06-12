import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, firebaseEnabled } from '../firebase.js';

const SYNC_DEBOUNCE_MS = 800;
let syncTimer = null;
let getDataFn = null;

export function registerUserDataProvider(fn) {
  getDataFn = fn;
}

export function scheduleCloudSync() {
  if (!firebaseEnabled || !getDataFn) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const uid = auth?.currentUser?.uid;
    if (!uid || !getDataFn) return;
    try {
      const data = getDataFn();
      await setDoc(doc(db, 'users', uid), { ...data, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.warn('[userDataSync] save failed:', e.message);
    }
  }, SYNC_DEBOUNCE_MS);
}

export async function loadCloudUserData(uid) {
  if (!firebaseEnabled || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    if (e?.code === 'permission-denied') return null;
    throw e;
  }
}

export async function saveCloudUserData(uid, data) {
  if (!firebaseEnabled || !uid) return;
  try {
    await setDoc(doc(db, 'users', uid), { ...data, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    if (e?.code === 'permission-denied') return;
    throw e;
  }
}
