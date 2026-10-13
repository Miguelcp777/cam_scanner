<script setup>
// Selector de documentos de la biblioteca. multiple=true mantiene el orden de selección.
import { onMounted, ref } from 'vue'
import { listDocs } from '../lib/db'
import { formatDate } from '../lib/util'

const props = defineProps({ modelValue: Array, multiple: Boolean })
const emit = defineEmits(['update:modelValue'])
const docs = ref(null)

onMounted(async () => (docs.value = await listDocs()))

function toggle(id) {
  const sel = props.modelValue
  if (!props.multiple) return emit('update:modelValue', [id])
  emit('update:modelValue', sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
}
</script>

<template>
  <p v-if="docs && !docs.length" class="muted">No hay documentos. Importa o escanea alguno primero.</p>
  <div v-else class="picker">
    <label v-for="d in docs" :key="d.id" :class="['item', { on: modelValue.includes(d.id) }]">
      <input :type="multiple ? 'checkbox' : 'radio'" :checked="modelValue.includes(d.id)" @change="toggle(d.id)" />
      <span v-if="multiple && modelValue.includes(d.id)" class="order">{{ modelValue.indexOf(d.id) + 1 }}</span>
      <span class="name">{{ d.name }}</span>
      <span class="muted">{{ d.kind === 'pdf' ? 'PDF' : 'Escaneo' }} · {{ d.pageCount ?? '?' }} pág. · {{ formatDate(d.updatedAt) }}</span>
    </label>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow: auto; }
.item { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; flex-wrap: wrap; }
.item.on { border-color: var(--accent); background: var(--accent-soft); }
.name { font-weight: 600; flex: 1; min-width: 120px; }
.order { background: var(--accent); color: #fff; border-radius: 50%; width: 22px; height: 22px; display: grid; place-items: center; font-size: .8rem; }
.muted { font-size: .85rem; }
</style>
