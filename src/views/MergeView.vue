<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import { getDoc } from '../lib/db'
import { mergeDocs } from '../lib/pdf'
import { savePdf } from '../lib/util'

const router = useRouter()
const selected = ref([])
const name = ref('Documento combinado')
const busy = ref(false)
const error = ref('')

async function merge() {
  busy.value = true
  error.value = ''
  try {
    const docs = await Promise.all(selected.value.map(getDoc))
    const { blob } = await mergeDocs(docs)
    const doc = await savePdf({ name: name.value.trim() || 'Documento combinado', blob })
    router.push({ path: '/file/detail', query: { id: doc.id } })
  } catch (e) {
    error.value = 'No se pudo combinar: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>Combinar archivos</h1>
  <p class="muted">Selecciona dos o más documentos en el orden en que quieres unirlos.</p>
  <DocPicker v-model="selected" multiple />
  <div class="row bar">
    <input v-model="name" type="text" placeholder="Nombre del nuevo PDF" />
    <button class="btn primary" :disabled="selected.length < 2 || busy" @click="merge">
      {{ busy ? 'Combinando…' : `🧩 Combinar ${selected.length || ''}` }}
    </button>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.bar { margin-top: 16px; }
</style>
