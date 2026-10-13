<script setup>
// Etiquetas de un documento: chips con ✕ y campo para añadir (sugiere las ya usadas)
import { onMounted, ref } from 'vue'
import { listTags } from '../lib/db'

const props = defineProps({ modelValue: { type: Array, default: () => [] } })
const emit = defineEmits(['update:modelValue'])
const text = ref('')
const known = ref([])
const listId = `tags-${Math.random().toString(36).slice(2)}`

onMounted(async () => (known.value = await listTags()))

function add() {
  const t = text.value.trim().replace(/\s+/g, ' ')
  text.value = ''
  if (!t || props.modelValue.some((x) => x.toLowerCase() === t.toLowerCase())) return
  emit('update:modelValue', [...props.modelValue, t])
}

const remove = (t) => emit('update:modelValue', props.modelValue.filter((x) => x !== t))
</script>

<template>
  <div class="tags">
    <span v-for="t in modelValue" :key="t" class="chip">🏷 {{ t }} <button title="Quitar" @click="remove(t)">✕</button></span>
    <form class="add" @submit.prevent="add">
      <input v-model="text" type="text" :list="listId" placeholder="Añadir etiqueta" maxlength="30" enterkeyhint="done" />
      <datalist :id="listId"><option v-for="t in known" :key="t" :value="t" /></datalist>
      <button class="btn small" type="submit" :disabled="!text.trim()">＋</button>
    </form>
  </div>
</template>

<style scoped>
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); color: var(--accent-dark); border-radius: 14px; padding: 3px 4px 3px 10px; font-size: .85rem; }
.chip button { border: 0; background: none; color: inherit; cursor: pointer; font-size: .75rem; padding: 2px 6px; }
.add { display: flex; gap: 4px; }
.add input { width: 150px; padding: 5px 8px; }
</style>
