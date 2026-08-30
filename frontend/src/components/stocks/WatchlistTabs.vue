<template>
  <div class="flex items-center gap-1 px-4 py-2 border-b border-surface-300/50 flex-shrink-0 overflow-x-auto panel-scroll">
    <div
      v-for="(list, index) in watchlists"
      :key="list.id"
      class="flex items-center gap-0.5 flex-shrink-0 group rounded transition-colors"
      :class="{
        'opacity-50': draggingIndex === index,
        'ring-1 ring-accent/40 bg-accent/5': dropTargetIndex === index && draggingIndex !== null
      }"
      @dragover.prevent="onDragOver(index)"
      @dragleave="onDragLeave(index)"
      @drop.prevent="onDrop(index)"
    >
      <!-- Drag handle -->
      <span
        v-if="renamingId !== list.id && watchlists.length > 1"
        draggable="true"
        @dragstart="onDragStart($event, index)"
        @dragend="onDragEnd"
        class="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 px-0.5 select-none text-xs leading-none"
        :title="$t('watch.dragReorder')"
        @click.stop
      >≡</span>

      <!-- Rename mode -->
      <input
        v-if="renamingId === list.id"
        v-model="renameValue"
        @keydown.enter="commitRename(list.id)"
        @keydown.escape="cancelRename"
        @blur="commitRename(list.id)"
        class="text-xs px-2 py-1 rounded font-mono bg-surface-200 border border-accent/50 text-gray-200 focus:outline-none w-28"
        autofocus
      />
      <!-- Tab button -->
      <button
        v-else
        @click="selectList(list.id)"
        @dblclick="startRename(list)"
        class="text-xs px-2.5 py-1 rounded font-mono transition-colors flex items-center gap-1"
        :class="list.id === activeId ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-surface-200/60'"
        :title="list.id === activeId ? $t('watch.renameHint') : list.name"
      >
        <span class="max-w-[120px] truncate">{{ list.name }}</span>
        <span v-if="list.symbols.length" class="opacity-60 text-[10px]">{{ list.symbols.length }}</span>
      </button>
      <!-- Delete (not last list) -->
      <button
        v-if="watchlists.length > 1 && list.id === activeId && renamingId !== list.id"
        @click="confirmDelete(list)"
        class="text-gray-600 hover:text-bear opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1"
        :title="$t('watch.deleteList')"
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Create new list -->
    <input
      v-if="creating"
      v-model="newName"
      @keydown.enter="commitCreate"
      @keydown.escape="cancelCreate"
      @blur="commitCreate"
      :placeholder="$t('watch.listName')"
      class="text-xs px-2 py-1 rounded font-mono bg-surface-200 border border-accent/50 text-gray-200 placeholder-gray-600 focus:outline-none w-28 flex-shrink-0"
      autofocus
    />
    <button
      v-else
      @click="startCreate"
      class="text-xs px-2 py-1 rounded font-mono text-gray-500 hover:text-accent hover:bg-accent/10 transition-colors flex-shrink-0"
    >
      {{ $t('watch.newList') }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMarketStore } from '../../stores/marketStore.js';

const store = useMarketStore();
const { t } = useI18n();

const watchlists = computed(() => store.watchlists);
const activeId = computed(() => store.activeWatchlistId);

const creating = ref(false);
const newName = ref('');
const renamingId = ref(null);
const renameValue = ref('');
const draggingIndex = ref(null);
const dropTargetIndex = ref(null);

function selectList(id) {
  if (renamingId.value) return;
  store.setActiveWatchlist(id);
}

function onDragStart(e, index) {
  draggingIndex.value = index;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(index));
}

function onDragEnd() {
  draggingIndex.value = null;
  dropTargetIndex.value = null;
}

function onDragOver(index) {
  if (draggingIndex.value === null) return;
  dropTargetIndex.value = index;
}

function onDragLeave(index) {
  if (dropTargetIndex.value === index) dropTargetIndex.value = null;
}

function onDrop(toIndex) {
  const fromIndex = draggingIndex.value;
  draggingIndex.value = null;
  dropTargetIndex.value = null;
  if (fromIndex === null || fromIndex === toIndex) return;
  store.reorderWatchlists(fromIndex, toIndex);
}

function startCreate() {
  creating.value = true;
  newName.value = '';
}

function commitCreate() {
  if (!creating.value) return;
  const name = newName.value.trim() || t('watch.newListName');
  store.createWatchlist(name);
  creating.value = false;
  newName.value = '';
}

function cancelCreate() {
  creating.value = false;
  newName.value = '';
}

function startRename(list) {
  if (list.id !== activeId.value) return;
  renamingId.value = list.id;
  renameValue.value = list.name;
}

function commitRename(id) {
  if (renamingId.value !== id) return;
  const name = renameValue.value.trim();
  if (name) store.renameWatchlist(id, name);
  renamingId.value = null;
  renameValue.value = '';
}

function cancelRename() {
  renamingId.value = null;
  renameValue.value = '';
}

function confirmDelete(list) {
  if (!window.confirm(t('watch.deleteConfirm', { name: list.name }))) return;
  store.deleteWatchlist(list.id);
}
</script>
