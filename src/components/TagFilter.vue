<script setup>
// Fila de etiquetas para filtrar listas de documentos (v-model = etiqueta activa o '')
defineProps({ tags: Array, modelValue: String })
defineEmits(['update:modelValue'])
</script>

<template>
  <div v-if="tags.length" class="filter">
    <button :class="['chip', { on: !modelValue }]" @click="$emit('update:modelValue', '')">Todas</button>
    <button v-for="t in tags" :key="t" :class="['chip', { on: modelValue === t }]" @click="$emit('update:modelValue', modelValue === t ? '' : t)">
      🏷 {{ t }}
    </button>
  </div>
</template>

<style scoped>
.filter { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 12px; -webkit-overflow-scrolling: touch; }
.chip { flex-shrink: 0; border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 4px 12px; font: inherit; font-size: .85rem; cursor: pointer; white-space: nowrap; }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
