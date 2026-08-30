<template>
  <div :class="embed ? 'flex flex-col h-full overflow-hidden min-h-0' : 'card flex flex-col h-full overflow-hidden'">
    <div v-if="!embed" class="flex items-center justify-between px-3 py-2 border-b border-surface-300 flex-shrink-0">
      <span class="label">{{ $t('alerts.title') }}</span>
      <span v-if="alerts.length" class="text-xs font-mono text-gray-500">{{ alerts.length }}</span>
    </div>

    <div class="panel-scroll flex-1 min-h-0">
      <div v-if="!alerts.length" class="flex items-center justify-center h-16 text-gray-500 text-xs">
        {{ $t('alerts.empty') }}
      </div>
      <button
        v-for="a in alerts"
        :key="a.id"
        @click="select(a.ticker)"
        class="w-full text-left px-3 py-1.5 border-b border-surface-300/30 hover:bg-surface-200/50 transition-colors flex items-start gap-2"
      >
        <span class="flex-shrink-0 mt-0.5 text-xs" :class="dirColor(a.direction)">{{ dirIcon(a.direction) }}</span>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-gray-300 leading-snug truncate" :title="a.message">{{ a.message }}</div>
          <div class="flex items-center gap-2 text-[10px] font-mono text-gray-600">
            <span>{{ kindLabel(a.kind) }}</span>
            <span class="ml-auto">{{ timeAgo(a.created_at) }}</span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useScannerStore } from '../../stores/scannerStore.js';
import { useMarketStore } from '../../stores/marketStore.js';

defineProps({
  embed: Boolean
});

const scanner = useScannerStore();
const market = useMarketStore();
const { t } = useI18n();
const alerts = computed(() => scanner.alerts);

function kindLabel(kind) {
  const key = `alerts.kinds.${kind}`;
  const translated = t(key);
  return translated === key ? kind : translated;
}
function dirIcon(d) { return d > 0 ? '▲' : d < 0 ? '▼' : '◆'; }
function dirColor(d) { return d > 0 ? 'text-bull' : d < 0 ? 'text-bear' : 'text-neutral'; }

function timeAgo(ts) {
  if (!ts) return '';
  const iso = String(ts).includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (isNaN(mins) || mins < 1) return t('time.now');
  if (mins < 60) return t('time.minutesShort', { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return t('time.hoursShort', { n: h });
  return t('time.daysShort', { n: Math.floor(h / 24) });
}

async function select(ticker) {
  await market.selectSymbol(ticker);
}
</script>
