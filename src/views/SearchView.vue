<script setup>
// /file/search?q=… — busca en nombres y en el texto reconocido (OCR) de los documentos
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocCard from '../components/DocCard.vue'
import { searchDocs } from '../lib/search'

const route = useRoute()
const router = useRouter()
const q = ref(route.query.q || '')
const results = ref(null)
const input = ref(null)
let timer = null

async function run() {
  results.value = q.value.trim() ? await searchDocs(q.value) : null
}

// Búsqueda mientras se escribe, con una pequeña espera
watch(q, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    router.replace({ query: v ? { q: v } : {} })
    run()
  }, 250)
})

onMounted(() => {
  input.value?.focus()
  run()
})

// Resalta los términos buscados en el fragmento (sin HTML del usuario: se escapa antes)
function highlight(text) {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const terms = q.value.trim().split(/\s+/).filter((t) => t.length > 1)
  if (!terms.length) return esc
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return esc.replace(re, '<mark>$1</mark>')
}
</script>

<template>
  <h1>Buscar</h1>
  <input ref="input" v-model="q" type="search" class="search" placeholder="Nombre o texto del documento…" enterkeyhint="search" />
  <p class="muted tip">Busca también dentro del texto de los documentos a los que hayas aplicado "Extraer texto" (OCR).</p>

  <template v-if="results">
    <p class="muted">{{ results.length }} resultado(s)</p>
    <div class="results">
      <div v-for="r in results" :key="r.doc.id" class="result">
        <DocCard :doc="r.doc" mode="list" />
        <p v-if="r.snippet" class="snippet" v-html="highlight(r.snippet)" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.search { width: 100%; font: inherit; font-size: 16px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.search:focus { outline: 2px solid var(--accent); border-color: transparent; }
.tip { font-size: .85rem; margin: 8px 0 16px; }
.results { display: flex; flex-direction: column; gap: 10px; }
.snippet { margin: 4px 0 0 52px; font-size: .85rem; color: var(--muted); }
.snippet :deep(mark) { background: #fff1a8; color: var(--text); border-radius: 2px; }
</style>
