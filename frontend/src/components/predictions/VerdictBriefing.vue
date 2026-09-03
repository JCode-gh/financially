<template>
  <div v-if="hasContent" class="space-y-3">
    <div v-if="notesReply">
      <p class="text-[11px] font-mono text-accent uppercase tracking-wide mb-1">{{ $t('brief.notesApplied') }}</p>
      <p class="text-sm text-gray-200 leading-relaxed">{{ notesReply }}</p>
      <p v-if="claimCheckLabel" class="mt-1 text-[11px] font-mono" :class="claimCheckClass">{{ claimCheckLabel }}</p>
      <p v-if="notesImpactLabel" class="mt-1 text-[11px] font-mono text-gray-500">{{ notesImpactLabel }}</p>
    </div>

    <div v-if="considered.length">
      <p class="text-[11px] font-mono text-gray-500 uppercase tracking-wide mb-1.5">{{ $t('brief.considered') }}</p>
      <ul class="space-y-1">
        <li v-for="item in considered" :key="item.id" class="text-xs text-gray-300 leading-snug">
          <span class="font-mono text-gray-500">{{ item.label }}</span>
          <span class="text-gray-400"> · </span>
          <span>{{ item.value }}</span>
        </li>
      </ul>
    </div>

    <div v-if="headlines.length">
      <p class="text-[11px] font-mono text-gray-500 uppercase tracking-wide mb-1.5">{{ $t('brief.headlinesUsed') }}</p>
      <ul class="space-y-1">
        <li v-for="(h, i) in headlines" :key="h.url || i" class="text-xs text-gray-400 leading-snug">
          {{ h.title }}<span v-if="h.source" class="text-gray-600"> · {{ h.source }}</span>
        </li>
      </ul>
    </div>

    <div v-if="overlooked.length">
      <p class="text-[11px] font-mono text-accent uppercase tracking-wide mb-1.5">{{ $t('brief.overlooked') }}</p>
      <ul class="space-y-1">
        <li v-for="(line, i) in overlooked" :key="i" class="text-sm text-gray-200 leading-relaxed">{{ line }}</li>
      </ul>
    </div>

    <div v-if="world.length">
      <p class="text-[11px] font-mono text-gray-500 uppercase tracking-wide mb-1.5">{{ $t('brief.worldHits') }}</p>
      <ul class="space-y-1.5">
        <li v-for="w in world" :key="w.url || w.title">
          <a
            v-if="hrefOf(w.url)"
            :href="hrefOf(w.url)"
            target="_blank"
            rel="noopener noreferrer"
            class="text-xs text-accent hover:underline underline-offset-2"
          >{{ w.title }}</a>
          <span v-else class="text-xs text-gray-300">{{ w.title }}</span>
          <p v-if="w.summary" class="text-[11px] text-gray-500 leading-relaxed">{{ w.summary }}</p>
        </li>
      </ul>
    </div>

    <div v-if="skipped.length">
      <p class="text-[11px] font-mono text-gray-600 uppercase tracking-wide mb-1.5">{{ $t('brief.skipped') }}</p>
      <ul class="space-y-1">
        <li v-for="item in skipped" :key="item.id" class="text-[11px] text-gray-500 leading-snug">
          {{ item.label }}<span class="text-gray-600"> — {{ item.why }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  briefing: { type: Object, default: null },
  overlooked: { type: Array, default: () => [] }
});

const { t } = useI18n();

const considered = computed(() => props.briefing?.considered || []);
const skipped = computed(() => props.briefing?.skipped || []);
const headlines = computed(() => (props.briefing?.headlines || []).filter(h => h?.title).slice(0, 8));
const world = computed(() => (props.briefing?.world || []).filter(w => w?.title).slice(0, 6));
const notesReply = computed(() => String(props.briefing?.notesReply || '').trim());
const overlooked = computed(() => {
  const fromAi = (props.overlooked || []).filter(Boolean);
  if (fromAi.length) return fromAi;
  return [];
});

const claimCheck = computed(() => props.briefing?.claimCheck || '');
const claimCheckLabel = computed(() => {
  if (claimCheck.value === 'contradicted') return t('brief.claimContradicted');
  if (claimCheck.value === 'unverified') return t('brief.claimUnverified');
  if (claimCheck.value === 'confirmed') return t('brief.claimConfirmed');
  return '';
});
const claimCheckClass = computed(() => {
  if (claimCheck.value === 'contradicted') return 'text-bear';
  if (claimCheck.value === 'unverified') return 'text-neutral';
  if (claimCheck.value === 'confirmed') return 'text-bull';
  return 'text-gray-500';
});

const notesImpactLabel = computed(() => {
  const impact = props.briefing?.notesReply
    ? (props.briefing.notesImpact || '')
    : '';
  if (claimCheck.value === 'contradicted' || claimCheck.value === 'unverified') return '';
  if (impact === 'changed') return t('brief.impactChanged');
  if (impact === 'tilted') return t('brief.impactTilted');
  if (notesReply.value) return t('brief.impactNone');
  return '';
});

const hasContent = computed(() =>
  considered.value.length
  || skipped.value.length
  || headlines.value.length
  || world.value.length
  || overlooked.value.length
  || notesReply.value
);

function hrefOf(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
  } catch {
    return '';
  }
}
</script>
