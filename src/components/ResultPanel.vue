<script setup>
import { computed, ref } from 'vue'
import { canShareFiles, downloadAll, shareFiles } from '../lib/share'

const props = defineProps({ results: Array })
defineEmits(['close'])
const shareable = computed(() => canShareFiles(props.results))
const note = ref('')

const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)

async function share() {
  note.value = ''
  if (!(await shareFiles(props.results))) {
    note.value = 'No se pudo abrir el menú de compartir; se descarga en su lugar.'
    downloadAll(props.results)
  }
}
</script>

<template>
  <section class="card result">
    <div class="row">
      <h2>✅ Listo</h2>
      <span class="spacer" />
      <button class="btn small" @click="$emit('close')">✕</button>
    </div>
    <ul>
      <li v-for="r in results" :key="r.name">{{ r.name }} <span class="muted">· {{ kb(r.blob.size) }}</span></li>
    </ul>
    <div class="row">
      <button v-if="shareable" class="btn primary" @click="share">📤 Compartir / Guardar</button>
      <button :class="['btn', { primary: !shareable }]" @click="downloadAll(results)">⬇ Descargar</button>
    </div>
    <p v-if="note" class="muted">{{ note }}</p>
  </section>
</template>

<style scoped>
.result { margin: 16px 0; border-color: var(--accent); display: flex; flex-direction: column; gap: 10px; }
ul { margin: 0; padding-left: 20px; max-height: 160px; overflow: auto; word-break: break-all; }
</style>
