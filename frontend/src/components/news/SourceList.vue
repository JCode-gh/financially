<template>
  <div v-if="digest || items.length">
    <p
      v-if="digest"
      class="text-sm text-gray-200 leading-relaxed mb-3"
    >{{ digest }}</p>
    <p
      v-if="heading && items.length"
      class="text-[11px] font-mono text-gray-500 uppercase tracking-wide mb-1.5"
    >{{ heading }}</p>
    <ul v-if="items.length" :class="compact ? 'space-y-2' : 'space-y-2.5'">
      <li v-for="s in items" :key="s.url || s.title" class="min-w-0">
        <a
          v-if="hrefOf(s.url)"
          :href="hrefOf(s.url)"
          target="_blank"
          rel="noopener noreferrer"
          class="group block rounded-md -mx-1 px-1 py-0.5 hover:bg-white/[0.03] cursor-pointer"
          @click.stop
        >
          <span class="source-link text-accent group-hover:underline underline-offset-2">{{ s.title }}</span>
          <p v-if="s.summary" class="mt-0.5 text-xs text-gray-400 leading-relaxed group-hover:text-gray-300">{{ s.summary }}</p>
        </a>
        <div v-else>
          <span class="text-gray-300">{{ s.title }}</span>
          <p v-if="s.summary" class="mt-0.5 text-xs text-gray-400 leading-relaxed">{{ s.summary }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  digest: { type: String, default: '' },
  heading: { type: String, default: '' },
  compact: { type: Boolean, default: false }
});

function hrefOf(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch {
    return '';
  }
}
</script>
