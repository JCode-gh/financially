<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
    @click.self="close"
  >
    <div class="bg-surface-100 border border-surface-300 rounded-lg shadow-xl w-full max-w-sm">
      <div class="flex items-center justify-between px-4 py-3 border-b border-surface-300">
        <h2 class="text-sm font-medium text-white">{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h2>
        <button @click="close" class="text-gray-500 hover:text-gray-300 p-1">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <form @submit.prevent="submit" class="p-4 space-y-3">
        <div v-if="!authStore.firebaseEnabled" class="text-xs text-neutral font-mono">
          Firebase is not configured. Add keys to <code class="text-accent">frontend/.env</code> (see <code class="text-accent">frontend/.env.example</code>).
        </div>

        <div v-if="mode === 'register'">
          <label class="text-xs text-gray-500 font-mono block mb-1">Name (optional)</label>
          <input
            v-model="displayName"
            type="text"
            autocomplete="name"
            class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label class="text-xs text-gray-500 font-mono block mb-1">Email</label>
          <input
            v-model="email"
            type="email"
            required
            autocomplete="email"
            class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label class="text-xs text-gray-500 font-mono block mb-1">Password</label>
          <input
            v-model="password"
            type="password"
            required
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            minlength="6"
            class="w-full bg-surface-200 border border-surface-300 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent/50"
          />
        </div>

        <p v-if="localError || authStore.error" class="text-xs text-bear font-mono">
          {{ localError || authStore.error }}
        </p>

        <button
          type="submit"
          :disabled="submitting || !authStore.firebaseEnabled"
          class="w-full py-2 rounded text-sm font-mono bg-accent/20 text-accent border border-accent/40 hover:bg-accent/30 disabled:opacity-50 transition-colors"
        >
          {{ submitting ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Register') }}
        </button>

        <p class="text-xs text-gray-500 text-center font-mono">
          <template v-if="mode === 'login'">
            No account?
            <button type="button" @click="switchMode('register')" class="text-accent hover:text-accent/70">Register</button>
          </template>
          <template v-else>
            Already have an account?
            <button type="button" @click="switchMode('login')" class="text-accent hover:text-accent/70">Sign in</button>
          </template>
        </p>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useAuthStore } from '../../stores/authStore.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  initialMode: { type: String, default: 'login' }
});

const emit = defineEmits(['close']);

const authStore = useAuthStore();

const mode = ref(props.initialMode);
const email = ref('');
const password = ref('');
const displayName = ref('');
const submitting = ref(false);
const localError = ref('');

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    mode.value = props.initialMode;
    localError.value = '';
    authStore.clearError();
  }
});

function switchMode(m) {
  mode.value = m;
  localError.value = '';
  authStore.clearError();
}

function close() {
  emit('close');
}

function friendlyError(e) {
  const code = e?.code || '';
  if (code === 'auth/email-already-in-use') return 'Email already in use';
  if (code === 'auth/invalid-email') return 'Invalid email address';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') return 'Wrong email or password';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters';
  if (code === 'auth/too-many-requests') return 'Too many attempts — try again later';
  return e?.message || 'Something went wrong';
}

async function submit() {
  if (!authStore.firebaseEnabled) return;
  submitting.value = true;
  localError.value = '';
  authStore.clearError();
  try {
    if (mode.value === 'login') {
      await authStore.login(email.value, password.value);
    } else {
      await authStore.register(email.value, password.value, displayName.value);
    }
    email.value = '';
    password.value = '';
    displayName.value = '';
    close();
  } catch (e) {
    localError.value = friendlyError(e);
  } finally {
    submitting.value = false;
  }
}
</script>
