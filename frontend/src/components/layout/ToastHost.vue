<template>
  <div class="fixed bottom-20 lg:bottom-10 right-3 lg:right-4 z-[80] flex flex-col gap-2 max-w-[min(20rem,calc(100vw-1.5rem))] pointer-events-none">
    <div
      v-for="t in ui.toasts"
      :key="t.id"
      class="pointer-events-auto card px-3 py-2 text-xs font-mono shadow-xl"
      :class="t.type === 'error' ? 'border-bear/40 text-bear' : t.type === 'ok' ? 'border-bull/40 text-bull' : 'text-gray-300'"
    >
      {{ t.message }}
    </div>
  </div>
</template>

<script setup>
import { useUiStore } from '../../stores/uiStore.js';
const ui = useUiStore();
</script>
