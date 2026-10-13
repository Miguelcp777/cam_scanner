<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ResultPanel from '../components/ResultPanel.vue'
import { TARGETS } from '../lib/convert'
import { deleteDoc, getDoc, listFolders, saveDoc } from '../lib/db'
import { layoutText } from '../lib/layout'
import { recognize } from '../lib/ocr'
import { pageLayouts } from '../lib/pages'
import { docToPdfBlob } from '../lib/pdf'
import { blobUrl, formatDate } from '../lib/util'

const route = useRoute()
const router = useRouter()
const doc = ref(null)
const missing = ref(false)
const folders = ref([])
const busy = ref('')
const progress = ref(0)
const error = ref('')
const results = ref(null)

const isScan = computed(() => doc.value?.kind === 'scan')
const fullText = computed(() =>
  isScan.value ? (doc.value?.pages || []).map((p) => p.text).filter(Boolean).join('\n\n') : doc.value?.text || '',
)
const convertRoutes = { word: '/tools/pdftoword', excel: '/tools/pdftoexcel', ppt: '/tools/pdftoppt', image: '/tools/pdftopic' }

async function load() {
  results.value = null
  doc.value = await getDoc(route.query.id)
  missing.value = !doc.value
  folders.value = await listFolders()
}

async function persist() {
  doc.value = await saveDoc(doc.value)
}

async function task(label, fn) {
  busy.value = label
  error.value = ''
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

const exportPdf = () =>
  task('Generando PDF…', async () => {
    results.value = [{ blob: await docToPdfBlob(doc.value), name: `${doc.value.name}.pdf` }]
  })

// Escaneos: OCR por página. PDF: capa de texto si existe, OCR en páginas escaneadas.
const runOcr = () =>
  task('Reconociendo texto…', async () => {
    const onProgress = (v) => (progress.value = v)
    if (isScan.value) {
      const texts = await recognize(doc.value.pages.map((p) => p.blob), onProgress)
      texts.forEach((t, i) => (doc.value.pages[i].text = t))
    } else {
      doc.value.text = (await pageLayouts(doc.value, onProgress)).map(layoutText).join('\n\n')
    }
    await persist()
  })

function movePage(i, d) {
  const p = doc.value.pages
  ;[p[i], p[i + d]] = [p[i + d], p[i]]
  persist()
}

async function removePage(i) {
  if (!confirm(`¿Eliminar la página ${i + 1}?`)) return
  doc.value.pages.splice(i, 1)
  await persist()
}

async function removeDoc() {
  if (!confirm(`¿Eliminar "${doc.value.name}"? No se puede deshacer.`)) return
  await deleteDoc(doc.value.id)
  router.replace('/file/recent')
}

const copyText = () => navigator.clipboard.writeText(fullText.value)
const exportText = () => (results.value = [{ blob: new Blob([fullText.value], { type: 'text/plain' }), name: `${doc.value.name}.txt` }])

watch(() => route.query.id, load, { immediate: true })
</script>

<template>
  <p v-if="missing" class="muted">El documento no existe. <RouterLink to="/file/recent" class="error">Volver</RouterLink></p>
  <template v-else-if="doc">
    <div class="row head">
      <input v-model="doc.name" type="text" class="title" @change="persist" />
      <span class="muted">{{ formatDate(doc.updatedAt) }} · {{ doc.pageCount ?? '?' }} pág.</span>
    </div>

    <div class="row toolbar">
      <button class="btn primary" :disabled="!!busy" @click="exportPdf">📤 Exportar PDF</button>
      <button class="btn" :disabled="!!busy || (isScan && !doc.pages.length)" @click="runOcr">🔤 Extraer texto</button>
      <RouterLink class="btn" :to="{ path: '/sign/detail', query: { id: doc.id } }">✍️ Firmar</RouterLink>
      <RouterLink v-if="isScan" class="btn" :to="{ path: '/scanner', query: { append: doc.id } }">➕ Páginas</RouterLink>
      <RouterLink class="btn" :to="{ path: '/tools/extractpdfpages', query: { id: doc.id } }">✂️ Extraer páginas</RouterLink>
    </div>
    <div class="row toolbar">
      <span class="muted">Convertir a:</span>
      <RouterLink v-for="(t, k) in TARGETS" :key="k" class="btn small" :to="{ path: convertRoutes[k], query: { id: doc.id } }">
        {{ t.ico }} {{ t.label }}
      </RouterLink>
      <span class="spacer" />
      <select v-model="doc.folderId" @change="persist">
        <option :value="null">📁 Mi documento (raíz)</option>
        <option v-for="f in folders" :key="f.id" :value="f.id">📁 {{ f.name }}</option>
      </select>
      <button class="btn danger" @click="removeDoc">🗑 Eliminar</button>
    </div>

    <div v-if="busy" class="busy">
      <span class="muted">⏳ {{ busy }}</span>
      <div v-if="busy.startsWith('Reconociendo')" class="progress"><div :style="{ width: progress * 100 + '%' }" /></div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <ResultPanel v-if="results" :results="results" @close="results = null" />

    <div v-if="isScan" class="pages">
      <div v-for="(p, i) in doc.pages" :key="p.id" class="page">
        <a :href="blobUrl(p.blob)" target="_blank"><img :src="blobUrl(p.blob)" alt="" /></a>
        <div class="row">
          <span class="muted">{{ i + 1 }}</span>
          <span v-if="p.text" class="muted" title="Texto reconocido">🔤</span>
          <span class="spacer" />
          <button class="btn small" :disabled="i === 0" @click="movePage(i, -1)">◀</button>
          <button class="btn small" :disabled="i === doc.pages.length - 1" @click="movePage(i, 1)">▶</button>
          <button class="btn small danger" @click="removePage(i)">🗑</button>
        </div>
      </div>
    </div>
    <template v-else>
      <iframe :src="blobUrl(doc.pdf)" class="pdf" title="Vista del PDF" />
      <a :href="blobUrl(doc.pdf)" target="_blank" class="muted open">Abrir el PDF a pantalla completa ↗</a>
    </template>

    <section v-if="fullText" class="card text">
      <div class="row">
        <h2>Texto reconocido</h2>
        <span class="spacer" />
        <button class="btn small" @click="copyText">📋 Copiar</button>
        <button class="btn small" @click="exportText">📤 .txt</button>
      </div>
      <textarea :value="fullText" readonly />
    </section>
  </template>
</template>

<style scoped>
.head { margin-bottom: 12px; }
.title { font-size: 1.3rem; font-weight: 700; flex: 1; min-width: 200px; border-color: transparent; background: transparent; }
.title:hover, .title:focus { border-color: var(--border); background: var(--surface); }
.toolbar { margin-bottom: 10px; }
.busy { margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
.pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; margin-top: 8px; }
.page { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px; }
.page img { width: 100%; aspect-ratio: 3 / 4; object-fit: contain; background: #eef1f3; border-radius: 6px; display: block; }
.pdf { width: 100%; height: 75vh; border: 1px solid var(--border); border-radius: 10px; background: #fff; margin-top: 8px; }
.open { display: inline-block; margin-top: 6px; font-size: .9rem; }
.text { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 720px) {
  .pages { grid-template-columns: repeat(2, 1fr); }
  .pdf { height: 60vh; }
}
</style>
