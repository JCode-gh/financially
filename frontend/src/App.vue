<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <AppHeader />
    <main class="flex-1 min-h-0 overflow-hidden">
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import AppHeader from './components/layout/AppHeader.vue';
</script>
