<script setup>
// Ajustes (/user): copia de seguridad, restaurar, almacenamiento y papelera
import { onMounted, ref } from 'vue'
import ResultPanel from '../components/ResultPanel.vue'
import { createBackup, readBackup, restoreBackup } from '../lib/backup'
import { listDocs, listTrash } from '../lib/db'
import { formatDate } from '../lib/util'

const busy = ref('')
const progress = ref(0)
const error = ref('')
const message = ref('')
const results = ref(null)
const pendingRestore = ref(null)
const fileInput = ref(null)
const stats = ref(null)

const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB'

async function loadStats() {
  const est = await navigator.storage?.estimate?.().catch(() => null)
  const persisted = await navigator.storage?.persisted?.().catch(() => null)
  stats.value = { docs: (await listDocs()).length, trash: (await listTrash()).length, usage: est?.usage, quota: est?.quota, persisted }
}

async function task(label, fn) {
  busy.value = label
  error.value = ''
  message.value = ''
  progress.value = 0
  try {
    await fn()
  } catch (e) {
    console.error(e)
    error.value = e.message || String(e)
  } finally {
    busy.value = ''
  }
}

const backup = () =>
  task('Creando copia de seguridad…', async () => {
    const r = await createBackup((p) => (progress.value = p))
    results.value = [{ blob: r.blob, name: r.name }]
    message.value = `Copia con ${r.counts.docs} documento(s), ${r.counts.folders} carpeta(s) y ${r.counts.signatures} firma(s). Guárdala en Archivos o iCloud Drive.`
  })

const pick = (files) =>
  task('Leyendo la copia…', async () => {
    if (!files?.length) return
    pendingRestore.value = await readBackup(files[0])
  })

const confirmRestore = () =>
  task('Restaurando…', async () => {
    const r = pendingRestore.value
    await restoreBackup(r)
    message.value = `Restaurados ${r.docs.length} documento(s), ${r.folders.length} carpeta(s) y ${r.signatures.length} firma(s).`
    pendingRestore.value = null
    await loadStats()
  })

onMounted(loadStats)
</script>

<template>
  <h1>⚙️ Ajustes</h1>

  <section class="card block">
    <h2>Copia de seguridad</h2>
    <p class="muted">Tus documentos solo están en este dispositivo. Haz copias de vez en cuando y guárdalas en Archivos / iCloud Drive para no perderlos si se borran los datos del navegador o cambias de móvil.</p>
    <div class="row">
      <button class="btn primary" :disabled="!!busy" @click="backup">💾 Crear copia de seguridad</button>
      <button class="btn" :disabled="!!busy" @click="fileInput.click()">📂 Restaurar una copia</button>
      <input ref="fileInput" type="file" accept=".zip,application/zip" hidden @change="pick($event.target.files); $event.target.value = ''" />
    </div>
    <div v-if="busy" class="busy">
      <span class="muted">⏳ {{ busy }}</span>
      <div v-if="busy.startsWith('Creando')" class="progress"><div :style="{ width: progress * 100 + '%' }" /></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="message" class="ok">✅ {{ message }}</p>
    <ResultPanel v-if="results" :results="results" @close="results = null" />

    <div v-if="pendingRestore" class="card confirm">
      <p>
        Copia del <b>{{ formatDate(Date.parse(pendingRestore.createdAt)) }}</b>: {{ pendingRestore.docs.length }} documento(s),
        {{ pendingRestore.folders.length }} carpeta(s), {{ pendingRestore.signatures.length }} firma(s).
      </p>
      <p class="muted">Se añadirán a lo que ya tienes. Los documentos que ya existan (mismo documento) se sustituirán por la versión de la copia.</p>
      <div class="row">
        <button class="btn" @click="pendingRestore = null">Cancelar</button>
        <button class="btn primary" :disabled="!!busy" @click="confirmRestore">Restaurar</button>
      </div>
    </div>
  </section>

  <section class="card block">
    <h2>Almacenamiento</h2>
    <ul v-if="stats" class="stats">
      <li>{{ stats.docs }} documento(s) · <RouterLink to="/file/recycler">{{ stats.trash }} en la papelera</RouterLink></li>
      <li v-if="stats.usage != null">Espacio usado: {{ mb(stats.usage) }}<template v-if="stats.quota"> de {{ mb(stats.quota) }} disponibles</template></li>
      <li v-if="stats.persisted != null">
        Almacenamiento persistente: {{ stats.persisted ? 'sí ✅' : 'no — instala la app en la pantalla de inicio para que el navegador no borre los datos' }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.busy { display: flex; flex-direction: column; gap: 6px; }
.ok { color: var(--accent-dark); }
.confirm { border-color: var(--accent); background: var(--accent-soft); }
.confirm p { margin: 0 0 8px; }
.stats { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.stats a { color: var(--accent-dark); }
</style>
