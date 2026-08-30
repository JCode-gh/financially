<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="source-link text-accent hover:text-accent/80 underline-offset-2 hover:underline cursor-pointer"
    @click.stop
  >{{ text }}</a>
  <span v-else>{{ text }}</span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  href: { type: String, default: '' },
  text: { type: String, required: true }
});

const href = computed(() => {
  const raw = String(props.href || '').trim();
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch {
    return '';
  }
});
</script>
