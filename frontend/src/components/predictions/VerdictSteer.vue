<template>
  <div class="space-y-2">
    <div>
      <p class="text-[11px] font-mono text-gray-500 mb-1">{{ $t('brief.styleLabel') }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="s in styles"
          :key="s"
          type="button"
          class="text-[11px] font-mono px-2 py-1 rounded border transition-colors"
          :class="predictionStore.briefStyle === s
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-surface-300 text-gray-400 hover:text-gray-200 hover:border-gray-500'"
          @click="predictionStore.setBriefStyle(s)"
        >
          {{ $t(`brief.style.${s}`) }}
        </button>
      </div>
    </div>
    <div>
      <label class="text-[11px] font-mono text-gray-500 mb-1 block" for="brief-notes">
        {{ $t('brief.notesLabel') }}
      </label>
      <textarea
        id="brief-notes"
        v-model="notes"
        rows="2"
        maxlength="400"
        :placeholder="$t('brief.notesPlaceholder')"
        class="w-full resize-none rounded border border-surface-300 bg-surface-200 px-2.5 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-accent/50 focus:outline-none"
        @keydown.enter.exact.prevent="apply"
      />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        :disabled="loading"
        class="text-[11px] sm:text-xs px-2.5 py-1.5 rounded font-mono border transition-colors"
        :class="loading ? 'border-surface-300 text-gray-500' : 'border-accent/40 text-accent hover:bg-accent/10'"
        @click="apply"
      >
        {{ loading ? $t('verdict.readingShort') : $t('brief.apply') }}
      </button>
      <button
        v-if="predictionStore.briefNotes"
        type="button"
        class="text-[11px] font-mono text-gray-500 hover:text-gray-300"
        @click="clearNotes"
      >
        {{ $t('brief.notesClear') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePredictionStore } from '../../stores/predictionStore.js';
import { useMarketStore } from '../../stores/marketStore.js';

const props = defineProps({
  symbol: String,
  loading: Boolean
});

const emit = defineEmits(['applied']);

const predictionStore = usePredictionStore();
const marketStore = useMarketStore();
const styles = ['desk', 'plain', 'skeptic', 'detailed'];

const notes = computed({
  get: () => predictionStore.briefNotes,
  set: (v) => predictionStore.setBriefNotes(v)
});

async function apply() {
  if (!props.symbol || props.loading) return;
  try {
    await predictionStore.generateForSymbol(
      props.symbol,
      marketStore.selectedQuote?.name,
      { force: true, style: predictionStore.briefStyle, notes: predictionStore.briefNotes }
    );
    emit('applied');
  } catch { /* shown in verdict */ }
}

function clearNotes() {
  predictionStore.clearBriefNotes();
}
</script>
