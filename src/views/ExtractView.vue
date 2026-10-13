<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import { getDoc } from '../lib/db'
import { extractPages, parseRanges } from '../lib/pdf'
import { savePdf } from '../lib/util'

const route = useRoute()
const router = useRouter()
const selected = ref(route.query.id ? [route.query.id] : [])
const doc = ref(null)
const ranges = ref('')
const busy = ref(false)
const error = ref('')

const total = computed(() => doc.value?.pageCount ?? 0)

watch(
  selected,
  async (s) => {
    doc.value = s[0] ? await getDoc(s[0]) : null
    ranges.value = total.value ? `1-${total.value}` : ''
  },
  { immediate: true },
)

async function extract() {
  error.value = ''
  let indices
  try {
    indices = parseRanges(ranges.value, total.value)
  } catch (e) {
    error.value = e.message
    return
  }
  busy.value = true
  try {
    const { blob } = await extractPages(doc.value, indices)
    const out = await savePdf({ name: `${doc.value.name} (págs. ${ranges.value})`, blob, folderId: doc.value.folderId })
    router.push({ path: '/file/detail', query: { id: out.id } })
  } catch (e) {
    error.value = 'No se pudo extraer: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>Extraer páginas</h1>
  <p class="muted">Elige un documento e indica las páginas (por ejemplo: <code>1-3, 5, 8</code>). Se crea un PDF nuevo.</p>
  <DocPicker v-model="selected" />
  <div v-if="doc" class="row bar">
    <span>{{ doc.name }} — {{ total || '?' }} páginas</span>
    <input v-model="ranges" type="text" placeholder="1-3, 5" :disabled="!total" />
    <button class="btn primary" :disabled="busy || !total" @click="extract">{{ busy ? 'Extrayendo…' : '✂️ Extraer' }}</button>
  </div>
  <p v-if="doc && !total" class="error">No se pudo leer el número de páginas de este PDF.</p>
  <p v-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.bar { margin-top: 16px; }
</style>
