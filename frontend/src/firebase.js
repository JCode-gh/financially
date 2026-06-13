import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

export const firebaseEnabled = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

let app = null;
let auth = null;
let db = null;

if (firebaseEnabled) {
  app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
  });
  auth = getAuth(app);
  // experimentalForceLongPolling avoids Safari's CORS block on the bidirectional
  // streaming channel (Listen/channel) that getFirestore opens by default.
  db = initializeFirestore(app, { experimentalForceLongPolling: true });
}

export { app, auth, db };
