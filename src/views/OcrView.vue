<script setup>
import { ref } from 'vue'
import { recognize } from '../lib/ocr'
import { downloadBlob } from '../lib/pdf'

const input = ref(null)
const files = ref([])
const text = ref('')
const progress = ref(0)
const busy = ref(false)
const error = ref('')

const copy = () => navigator.clipboard.writeText(text.value)
const save = () => downloadBlob(new Blob([text.value], { type: 'text/plain' }), 'texto.txt')

async function run(list) {
  files.value = [...list].filter((f) => f.type.startsWith('image/'))
  if (!files.value.length) return
  busy.value = true
  error.value = ''
  text.value = ''
  progress.value = 0
  try {
    text.value = (await recognize(files.value, (v) => (progress.value = v))).join('\n\n')
  } catch (e) {
    error.value = 'Error de OCR: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <h1>Imagen a texto (OCR)</h1>
  <p class="muted">Reconoce texto en español e inglés. La primera vez se descargan los modelos de idioma.</p>
  <div class="row">
    <button class="btn primary" :disabled="busy" @click="input.click()">🖼️ Elegir imágenes</button>
    <span v-if="files.length" class="muted">{{ files.length }} imagen(es)</span>
  </div>
  <input ref="input" type="file" accept="image/*" multiple hidden @change="run($event.target.files); $event.target.value = ''" />

  <div v-if="busy" class="progress bar"><div :style="{ width: progress * 100 + '%' }" /></div>
  <p v-if="error" class="error">{{ error }}</p>

  <section v-if="text" class="card out">
    <div class="row">
      <h2>Resultado</h2>
      <span class="spacer" />
      <button class="btn small" @click="copy">📋 Copiar</button>
      <button class="btn small" @click="save">⬇ .txt</button>
    </div>
    <textarea v-model="text" />
  </section>
</template>

<style scoped>
.bar { margin: 16px 0; }
.out { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
</style>
