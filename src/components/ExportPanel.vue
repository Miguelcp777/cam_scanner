<script setup>
// Exportar PDF con opciones: calidad/tamaño, marca de agua y contraseña
import { ref } from 'vue'
import ResultPanel from './ResultPanel.vue'
import { exportPdf, QUALITIES } from '../lib/pdf'

const props = defineProps({ doc: Object })
defineEmits(['close'])

const quality = ref('original')
const watermark = ref('')
const password = ref('')
const showPw = ref(false)
const busy = ref(false)
const progress = ref(0)
const error = ref('')
const results = ref(null)
const note = ref('')

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

async function generate() {
  busy.value = true
  error.value = ''
  results.value = null
  progress.value = 0
  try {
    const r = await exportPdf(props.doc, { quality: quality.value, watermark: watermark.value, password: password.value }, (p) => (progress.value = p))
    note.value = r.note
    results.value = [{ blob: r.blob, name: `${props.doc.name}.pdf` }]
  } catch (e) {
    console.error(e)
    error.value = 'No se pudo generar el PDF: ' + (e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card exp">
    <div class="row">
      <h2>📤 Exportar PDF</h2>
      <span class="spacer" />
      <button class="btn small" @click="$emit('close')">✕</button>
    </div>

    <fieldset>
      <legend>Calidad</legend>
      <label v-for="(q, k) in QUALITIES" :key="k" class="opt">
        <input v-model="quality" type="radio" :value="k" />
        <b>{{ q.label }}</b> <span class="muted">— {{ q.note }}</span>
      </label>
      <p v-if="doc.kind === 'pdf' && quality !== 'original'" class="muted small">
        Para reducir un PDF se convierten sus páginas en imágenes: el texto dejará de poder seleccionarse.
      </p>
    </fieldset>

    <label class="field">
      <span>Marca de agua <span class="muted">(opcional)</span></span>
      <input v-model="watermark" type="text" maxlength="40" placeholder="Ej.: COPIA — Solo para trámite X" />
    </label>

    <label class="field">
      <span>Contraseña para abrir <span class="muted">(opcional)</span></span>
      <span class="row">
        <input v-model="password" :type="showPw ? 'text' : 'password'" autocomplete="new-password" placeholder="Sin contraseña" />
        <button class="btn small" type="button" @click="showPw = !showPw">{{ showPw ? '🙈' : '👁' }}</button>
      </span>
      <span v-if="password" class="muted small">Cifrado AES-256. Si olvidas la contraseña no se podrá abrir.</span>
    </label>

    <button class="btn primary" :disabled="busy" @click="generate">{{ busy ? 'Generando…' : '📄 Generar PDF' }}</button>
    <div v-if="busy && quality !== 'original'" class="progress"><div :style="{ width: progress * 100 + '%' }" /></div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="results" class="muted small">Tamaño: {{ kb(results[0].blob.size) }}<template v-if="note"> · {{ note }}</template></p>
    <ResultPanel v-if="results" :results="results" @close="results = null" />
  </section>
</template>

<style scoped>
.exp { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; border-color: var(--accent); }
fieldset { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
legend { font-weight: 600; padding: 0 4px; }
.opt { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field input { flex: 1; min-width: 0; }
.small { font-size: .8rem; margin: 0; }
</style>
