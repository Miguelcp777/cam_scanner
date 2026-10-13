<script setup>
// Reeditar una página guardada: /file/page?doc=<idDoc>&page=<idPágina>
// Si la página guarda su foto original, se puede rehacer el recorte; si es antigua, se parte del resultado.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageProcessor from '../components/PageProcessor.vue'
import { getDoc, saveDoc } from '../lib/db'

const route = useRoute()
const router = useRouter()
const doc = ref(null)
const error = ref('')

const index = computed(() => doc.value?.pages.findIndex((p) => p.id === route.query.page) ?? -1)
const page = computed(() => (index.value >= 0 ? doc.value.pages[index.value] : null))

onMounted(async () => {
  doc.value = await getDoc(route.query.doc)
  if (!page.value) error.value = 'No se encontró la página.'
})

const back = () => router.replace({ path: '/file/detail', query: { id: route.query.doc } })

async function onDone(result) {
  // El texto OCR ya no corresponde si cambió el recorte: se descarta
  Object.assign(doc.value.pages[index.value], result, { text: '' })
  await saveDoc(doc.value)
  back()
}
</script>

<template>
  <div class="row head">
    <h1>Editar página {{ index >= 0 ? index + 1 : '' }}</h1>
    <span class="spacer" />
    <span v-if="doc" class="muted">{{ doc.name }}</span>
  </div>
  <p v-if="error" class="error">{{ error }} <a href="#" @click.prevent="back">Volver</a></p>
  <p v-if="page && !page.original" class="muted">Página escaneada con una versión anterior: se edita sobre el resultado (sin la foto original).</p>
  <PageProcessor
    v-if="page"
    :source="page.original || page.blob"
    :is-original="!!page.original"
    :initial="page.original ? page : null"
    done-label="✓ Guardar cambios"
    cancel-label="Cancelar"
    @done="onDone"
    @cancel="back"
  />
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; }
</style>
