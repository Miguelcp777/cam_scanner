<script setup>
// /tools/pdftoword | pdftoexcel | pdftoppt | pdftopic  (el formato llega en route.meta.to)
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import ResultPanel from '../components/ResultPanel.vue'
import { TARGETS } from '../lib/convert'
import { getDoc } from '../lib/db'

const route = useRoute()
const target = computed(() => TARGETS[route.meta.to])
const selected = ref(route.query.id ? [route.query.id] : [])
const busy = ref(false)
const progress = ref(0)
const error = ref('')
const results = ref(null)

watch(() => route.meta.to, () => (results.value = null))

async function convert() {
  busy.value = true
  error.value = ''
  results.value = null
  progress.value = 0
  try {
    const doc = await getDoc(selected.value[0])
    results.value = await target.value.run(doc, (p) => (progress.value = p))
  } catch (e) {
    console.error(e)
    error.value = 'No se pudo convertir: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>{{ target.ico }} Convertir a {{ target.label }}</h1>
  <p class="muted">
    <template v-if="route.meta.to === 'image'">Cada página se exporta como una imagen JPG.</template>
    <template v-else-if="route.meta.to === 'ppt'">Cada página se convierte en una diapositiva.</template>
    <template v-else>
      Se reconstruye el texto{{ route.meta.to === 'excel' ? ' y las columnas de las tablas' : ' y los párrafos' }}.
      Si la página es una imagen (escaneo) se aplica OCR, que tarda más.
    </template>
  </p>
  <DocPicker v-model="selected" />
  <div class="row bar">
    <button class="btn primary" :disabled="!selected.length || busy" @click="convert">
      {{ busy ? 'Convirtiendo…' : `${target.ico} Convertir a ${target.label}` }}
    </button>
  </div>
  <div v-if="busy" class="progress"><div :style="{ width: progress * 100 + '%' }" /></div>
  <p v-if="error" class="error">{{ error }}</p>
  <ResultPanel v-if="results" :results="results" @close="results = null" />
</template>

<style scoped>
.bar { margin: 16px 0; }
</style>
