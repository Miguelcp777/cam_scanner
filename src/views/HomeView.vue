<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DocCard from '../components/DocCard.vue'
import { listDocs } from '../lib/db'
import { isIOS, isStandalone, useImport } from '../lib/util'

const router = useRouter()
const { handleFiles } = useImport()
const docs = ref([])
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const mode = ref(store.get('viewMode', 'grid'))
const showInstall = ref(isIOS() && !isStandalone() && !store.get('installHintClosed', ''))
const dragOver = ref(false)
const message = ref('')
const imgInput = ref(null)
const fileInput = ref(null)

const tools = [
  { to: '/tools/pdftoword', label: 'A Word', ico: '📝' },
  { to: '/tools/pdftoexcel', label: 'A Excel', ico: '📊' },
  { to: '/tools/pdftoppt', label: 'A PPT', ico: '📽️' },
  { to: '/tools/pdftopic', label: 'A Imagen', ico: '🖼️' },
  { to: '/tools/mergepdf', label: 'Combinar archivos', ico: '🧩' },
  { to: '/sign/home', label: 'Firmar', ico: '✍️' },
  { to: '/tools/webocr', label: 'Texto (OCR)', ico: '🔤' },
  { to: '/tools/main', label: 'Todas las herramientas', ico: '🧰' },
]

// Cámara dentro de la app: detecta los bordes en vivo y dispara sola.
function scan() {
  router.push({ path: '/scanner', query: { camera: 1 } })
}

function closeInstall() {
  showInstall.value = false
  store.set('installHintClosed', '1')
}

async function load() {
  docs.value = (await listDocs()).slice(0, 24)
}

async function onFiles(files) {
  if (!files?.length) return
  const r = await handleFiles(files)
  message.value = r.skipped ? `${r.skipped} archivo(s) ignorado(s): solo se admiten imágenes y PDF.` : ''
  if (r.pdfs && !r.images) await load()
}

function setMode(m) {
  mode.value = m
  store.set('viewMode', m)
}

onMounted(load)
</script>

<template>
  <div v-if="showInstall" class="card install">
    <span>📲 Para no perder tus documentos, añade DocScan a la pantalla de inicio: toca <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>. Safari puede borrar los datos de webs que no visitas en 7 días.</span>
    <button class="btn small" @click="closeInstall">✕</button>
  </div>
  <RouterLink to="/file/search" class="searchbar">🔍 <span>Buscar documentos o texto…</span></RouterLink>
  <section
    :class="['drop', { over: dragOver }]"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="dragOver = false; onFiles($event.dataTransfer.files)"
    @click.self="fileInput.click()"
  >
    <div class="drop-ico" @click="fileInput.click()">📄➕</div>
    <p @click="fileInput.click()">Arrastra archivos aquí, o haz clic para subir</p>
    <div class="actions">
      <button class="action" @click="scan">📷<span>Escanear</span></button>
      <button class="action" @click="imgInput.click()">🖼️<span>Importar imágenes</span></button>
      <button class="action" @click="fileInput.click()">📑<span>Importar archivos</span></button>
    </div>
    <p v-if="message" class="error">{{ message }}</p>
    <input ref="imgInput" type="file" accept="image/*" multiple hidden @change="onFiles($event.target.files)" />
    <input ref="fileInput" type="file" accept="image/*,application/pdf" multiple hidden @change="onFiles($event.target.files)" />
  </section>

  <div class="tool-grid tools">
    <RouterLink v-for="t in tools" :key="t.label" :to="{ path: t.to, query: t.query }" class="tool">
      <span class="ico">{{ t.ico }}</span>{{ t.label }}
    </RouterLink>
  </div>

  <div class="row head">
    <h2>Reciente</h2>
    <span class="spacer" />
    <button :class="['btn small', { primary: mode === 'list' }]" title="Lista" @click="setMode('list')">☰</button>
    <button :class="['btn small', { primary: mode === 'grid' }]" title="Cuadrícula" @click="setMode('grid')">▦</button>
    <RouterLink to="/file/manager" class="muted">Ver todos los documentos ›</RouterLink>
  </div>

  <p v-if="!docs.length" class="muted empty">No hay archivos todavía. Sube uno o escanea para empezar.</p>
  <div v-else :class="mode === 'grid' ? 'doc-grid' : 'doc-list'">
    <DocCard v-for="d in docs" :key="d.id" :doc="d" :mode="mode" />
  </div>
</template>

<style scoped>
.install { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; background: var(--accent-soft); border-color: var(--accent); font-size: .9rem; }
.searchbar {
  display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 11px 14px; margin-bottom: 14px; color: var(--muted);
}
.searchbar:hover { border-color: var(--accent); }
.drop {
  background: var(--surface); border: 2px dashed var(--border); border-radius: 16px; padding: 28px 20px;
  text-align: center; cursor: pointer; transition: border-color .15s, background .15s;
}
.drop.over { border-color: var(--accent); background: var(--accent-soft); }
.drop-ico { font-size: 2.4rem; }
.actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 8px; }
.action {
  flex: 1; max-width: 200px; min-width: 120px; border: 1px solid var(--border); background: var(--surface); border-radius: 12px;
  padding: 14px; font: inherit; font-size: 1.4rem; cursor: pointer; display: flex; flex-direction: column; gap: 6px; align-items: center;
}
.action span { font-size: .9rem; }
.action:hover { border-color: var(--accent); }
.tools { margin: 24px 0; }
.head { border-top: 1px solid var(--border); padding-top: 16px; margin-bottom: 14px; }
.empty { text-align: center; padding: 30px; }
</style>
