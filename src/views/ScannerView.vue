<script setup>
// Flujo: elegir (cámara / imágenes) → recortar → filtro → añadir página → revisar → guardar.
// ?camera=1 abre la cámara; ?append=<idDoc> añade las páginas a un documento existente.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CropEditor from '../components/CropEditor.vue'
import { createScanDoc, getDoc, saveDoc, uid } from '../lib/db'
import {
  applyFilter,
  canvasToBlob,
  createLiveDetector,
  detectCorners,
  FILTERS,
  flattenDocument,
  fullCorners,
  loadCV,
  prepareImage,
  releaseCanvas,
  warpDocument,
  warpImage,
} from '../lib/scan'
import { blobUrl, defaultScanName, isTouch, pending } from '../lib/util'

const route = useRoute()
const router = useRouter()

const step = ref('pick') // pick | camera | crop | filter | review
const busy = ref('')
const error = ref('')
const queue = ref([])
const pages = ref([])
const name = ref(defaultScanName())
const folderId = ref(null)
const appendTo = ref(route.query.append || null)

const video = ref(null)
const imgInput = ref(null)
const camInput = ref(null)
const touch = isTouch()
let stream = null

// Página en curso (canvas: se liberan al terminar cada página por el límite de memoria de iOS)
const cur = { img: null, warped: null, filtered: null }
function releaseCurrent() {
  ;['img', 'warped', 'filtered'].forEach((k) => {
    releaseCanvas(cur[k])
    cur[k] = null
  })
  URL.revokeObjectURL(curUrl.value)
}
const curUrl = ref('')
const curSize = ref({ w: 1, h: 1 })
const points = ref([])
const detected = ref(true)
const edited = ref(false) // el usuario ha movido las esquinas a mano

function setPoints(p) {
  points.value = p
  edited.value = true
}
const filter = ref('enhance')
const previewUrl = ref('')

async function run(label, fn) {
  busy.value = label
  error.value = ''
  try {
    await fn()
  } catch (e) {
    console.error(e)
    error.value = e.message || String(e)
  } finally {
    busy.value = ''
  }
}

// --- Cámara en la app con detección de bordes en vivo ---
const liveQuad = ref(null) // esquinas en coordenadas del vídeo
const videoSize = ref({ w: 1, h: 1 })
const stable = ref(0)
const auto = ref(true)
const STABLE_TICKS = 8 // ~1,2 s quieto → foto automática
const hints = new WeakMap() // foto → esquinas detectadas en vivo (respaldo)
let detector = null
let loopTimer = null
let capturing = false

const livePolygon = computed(() => liveQuad.value?.map((p) => `${p.x},${p.y}`).join(' ') || '')
const cameraHint = computed(() => {
  if (!liveQuad.value) return 'Buscando documento… Encuadra la hoja sobre un fondo que contraste.'
  if (!auto.value) return 'Documento detectado. Pulsa el botón para capturar.'
  return stable.value >= STABLE_TICKS / 2 ? 'Mantén el móvil quieto…' : 'Documento detectado'
})

async function startCamera() {
  error.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    })
    step.value = 'camera'
    await new Promise(requestAnimationFrame)
    video.value.srcObject = stream
    await video.value.play().catch(() => {})
    const { cv } = await loadCV()
    detector = createLiveDetector(cv)
    detectLoop()
  } catch (e) {
    error.value = 'No se pudo acceder a la cámara: ' + (e.message || e.name) + '. Puedes importar imágenes.'
    step.value = pages.value.length ? 'review' : 'pick'
  }
}

const moved = (a, b, tol) => a.some((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) > tol)

function detectLoop() {
  clearTimeout(loopTimer)
  if (!stream || !detector || step.value !== 'camera') return
  const v = video.value
  try {
    const q = v.readyState >= 2 ? detector.detect(v) : null
    videoSize.value = { w: v.videoWidth || 1, h: v.videoHeight || 1 }
    const tol = Math.max(videoSize.value.w, videoSize.value.h) * 0.025
    stable.value = q && liveQuad.value && !moved(q, liveQuad.value, tol) ? stable.value + 1 : 0
    liveQuad.value = q
    if (auto.value && stable.value >= STABLE_TICKS) return capture()
  } catch (e) {
    console.error(e)
  }
  loopTimer = setTimeout(detectLoop, 150)
}

function stopCamera() {
  clearTimeout(loopTimer)
  detector?.release()
  detector = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  liveQuad.value = null
  stable.value = 0
}

async function capture() {
  if (capturing || !stream) return
  capturing = true
  try {
    const v = video.value
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    const blob = await canvasToBlob(c, 'image/jpeg', 0.95)
    if (liveQuad.value) hints.set(blob, { pts: liveQuad.value, w: c.width })
    releaseCanvas(c)
    stopCamera()
    queue.value.push(blob)
    next()
  } finally {
    capturing = false
  }
}

function addImages(files) {
  queue.value.push(...[...files].filter((f) => f.type.startsWith('image/')))
  next()
}

function next() {
  if (!queue.value.length) {
    step.value = pages.value.length ? 'review' : 'pick'
    return
  }
  run('Detectando bordes…', async () => {
    const blob = queue.value[0]
    const src = await prepareImage(blob)
    cur.img = src
    curUrl.value = URL.createObjectURL(blob)
    curSize.value = { w: src.width, h: src.height }
    // 1) detección sobre la foto, 2) esquinas vistas en vivo, 3) imagen completa
    let pts = await detectCorners(src)
    const hint = hints.get(blob)
    if (!pts && hint) {
      const k = src.width / hint.w
      pts = hint.pts.map((p) => ({ x: p.x * k, y: p.y * k }))
    }
    detected.value = !!pts
    edited.value = false
    points.value = pts || fullCorners(src.width, src.height)
    step.value = 'crop'
  })
}

function confirmCrop() {
  run('Corrigiendo perspectiva…', async () => {
    releaseCanvas(cur.warped)
    if (edited.value) {
      cur.warped = await warpImage(cur.img, points.value)
    } else {
      // Esquinas automáticas: segunda pasada para ajustar al papel exacto
      const r = await warpDocument(cur.img, points.value)
      cur.warped = r.canvas
      points.value = r.points
    }
    await applyFlatten()
    await renderFilter(filter.value)
    step.value = 'filter'
  })
}

// Aplanado de papel curvado (si está activado y se detecta curvatura)
const flatten = ref(true)
const flattened = ref('') // descripción de lo corregido, para informar al usuario

async function applyFlatten() {
  flattened.value = ''
  if (!flatten.value) return
  busy.value = 'Aplanando el papel…'
  const r = await flattenDocument(cur.img, points.value)
  if (!r) return
  releaseCanvas(cur.warped)
  cur.warped = r.canvas
  flattened.value = [r.edges && 'bordes', r.lines && 'renglones'].filter(Boolean).join(' y ')
}

function toggleFlatten() {
  run('Aplanando el papel…', async () => {
    releaseCanvas(cur.warped)
    cur.warped = await warpImage(cur.img, points.value)
    await applyFlatten()
    await renderFilter(filter.value)
  })
}

async function renderFilter(f) {
  filter.value = f
  releaseCanvas(cur.filtered)
  cur.filtered = await applyFilter(cur.warped, f)
  previewUrl.value = cur.filtered.toDataURL('image/jpeg', 0.7)
}

function addPage() {
  run('Guardando página…', async () => {
    const blob = await canvasToBlob(cur.filtered)
    pages.value.push({ id: uid(), blob, width: cur.filtered.width, height: cur.filtered.height, text: '' })
    releaseCurrent()
    previewUrl.value = ''
    queue.value.shift()
    next()
  })
}

function discardCurrent() {
  releaseCurrent()
  queue.value.shift()
  next()
}

// Cámara en la app (detección en vivo). La cámara del sistema queda como alternativa en móvil.
function newPhoto() {
  startCamera()
}

function systemCamera() {
  stopCamera()
  step.value = pages.value.length ? 'review' : 'pick'
  camInput.value.click()
}

function movePage(i, d) {
  const p = pages.value
  ;[p[i], p[i + d]] = [p[i + d], p[i]]
}

function save() {
  run('Guardando documento…', async () => {
    let doc
    if (appendTo.value) {
      doc = await getDoc(appendTo.value)
      doc.pages.push(...pages.value)
      doc = await saveDoc(doc)
    } else {
      doc = await createScanDoc({ name: name.value.trim() || defaultScanName(), pages: pages.value, folderId: folderId.value })
    }
    router.replace({ path: '/file/detail', query: { id: doc.id } })
  })
}

onMounted(() => {
  if (pending.files.length) {
    queue.value = pending.files
    folderId.value = pending.folderId
    pending.files = []
    pending.folderId = null
    next()
  } else if (route.query.camera) {
    startCamera()
  }
})

onBeforeUnmount(() => {
  stopCamera()
  releaseCurrent()
})
</script>

<template>
  <div class="row head">
    <h1>{{ appendTo ? 'Añadir páginas' : 'Escanear' }}</h1>
    <span class="spacer" />
    <span v-if="pages.length" class="muted">{{ pages.length }} página(s)</span>
    <button v-if="pages.length && step !== 'review'" class="btn" @click="stopCamera(); step = 'review'">Revisar ›</button>
  </div>

  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="busy" class="muted">⏳ {{ busy }} <small v-if="busy.startsWith('Detectando')">(la primera vez se descarga OpenCV, ~10 MB)</small></p>

  <!-- Elegir origen -->
  <div v-if="step === 'pick' && !busy" class="pick">
    <button class="big" @click="newPhoto">📷<span>Escanear con la cámara</span></button>
    <button class="big" @click="imgInput.click()">🖼️<span>Importar imágenes</span></button>
  </div>
  <p v-if="step === 'pick' && touch && !busy" class="muted center-text">
    <a href="#" @click.prevent="camInput.click()">Usar la cámara del sistema (sin detección en vivo)</a>
  </p>

  <!-- Cámara con detección en vivo -->
  <div v-show="step === 'camera'" class="camera">
    <div class="viewfinder">
      <video ref="video" autoplay playsinline muted />
      <svg :viewBox="`0 0 ${videoSize.w} ${videoSize.h}`" preserveAspectRatio="xMidYMid meet">
        <polygon
          v-if="liveQuad"
          :points="livePolygon"
          :class="['live', { steady: stable >= STABLE_TICKS / 2 }]"
          :style="{ strokeWidth: Math.max(videoSize.w, videoSize.h) / 120 }"
        />
      </svg>
      <div class="cam-hint">{{ cameraHint }}</div>
    </div>
    <div class="row center">
      <button class="btn" @click="stopCamera(); step = pages.length ? 'review' : 'pick'">Cancelar</button>
      <button class="shutter" title="Capturar" @click="capture" />
      <label class="auto"><input v-model="auto" type="checkbox" /> Auto</label>
    </div>
    <div class="row center">
      <button class="btn small" @click="stopCamera(); imgInput.click()">🖼️ Galería</button>
      <button v-if="touch" class="btn small" @click="systemCamera">📷 Cámara del sistema</button>
    </div>
  </div>

  <!-- Recorte -->
  <div v-if="step === 'crop' && !busy" class="stage">
    <p v-if="detected" class="muted">Ajusta las esquinas al borde del documento.</p>
    <p v-else class="warn">No se detectó el borde del documento. Arrastra las esquinas a mano o repite la foto sobre un fondo que contraste con el papel.</p>
    <CropEditor :model-value="points" :src="curUrl" :width="curSize.w" :height="curSize.h" @update:model-value="setPoints" />
    <div class="row center">
      <button class="btn danger" @click="discardCurrent">Descartar</button>
      <button class="btn" @click="setPoints(fullCorners(curSize.w, curSize.h))">Imagen completa</button>
      <button class="btn primary" @click="confirmCrop">Recortar ›</button>
    </div>
    <p v-if="queue.length > 1" class="muted">Quedan {{ queue.length - 1 }} imagen(es) más.</p>
  </div>

  <!-- Filtros -->
  <div v-if="step === 'filter'" class="stage">
    <img :src="previewUrl" class="preview" alt="Vista previa" />
    <div class="row center flat">
      <label><input v-model="flatten" type="checkbox" :disabled="!!busy" @change="toggleFlatten" /> Aplanar curvatura</label>
      <span v-if="flatten && flattened" class="muted">· corregidos {{ flattened }}</span>
      <span v-else-if="flatten" class="muted">· sin curvatura apreciable</span>
    </div>
    <div class="row center">
      <button
        v-for="f in FILTERS"
        :key="f.id"
        :class="['btn', { primary: filter === f.id }]"
        :disabled="!!busy"
        @click="run('Aplicando filtro…', () => renderFilter(f.id))"
      >
        {{ f.label }}
      </button>
    </div>
    <div class="row center">
      <button class="btn" :disabled="!!busy" @click="step = 'crop'">‹ Recortar</button>
      <button class="btn primary" :disabled="!!busy" @click="addPage">✓ Añadir página</button>
    </div>
  </div>

  <!-- Revisión -->
  <div v-if="step === 'review' && !busy" class="stage review">
    <div class="pages">
      <div v-for="(p, i) in pages" :key="p.id" class="page">
        <img :src="blobUrl(p.blob)" alt="" />
        <div class="row">
          <span class="muted">{{ i + 1 }}</span>
          <span class="spacer" />
          <button class="btn small" :disabled="i === 0" @click="movePage(i, -1)">◀</button>
          <button class="btn small" :disabled="i === pages.length - 1" @click="movePage(i, 1)">▶</button>
          <button class="btn small danger" @click="pages.splice(i, 1)">🗑</button>
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn" @click="newPhoto">📷 Escanear otra</button>
      <button class="btn" @click="imgInput.click()">🖼️ Importar más</button>
      <span class="spacer" />
      <input v-if="!appendTo" v-model="name" type="text" placeholder="Nombre del documento" />
      <button class="btn primary" :disabled="!pages.length" @click="save">💾 Guardar</button>
    </div>
  </div>

  <input ref="imgInput" type="file" accept="image/*" multiple hidden @change="addImages($event.target.files); $event.target.value = ''" />
  <input ref="camInput" type="file" accept="image/*" capture="environment" hidden @change="addImages($event.target.files); $event.target.value = ''" />
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; }
.pick { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 20px; }
.big {
  flex: 1; min-width: 180px; padding: 40px 20px; font: inherit; font-size: 2.4rem; border-radius: 16px; cursor: pointer;
  border: 2px dashed var(--border); background: var(--surface); display: flex; flex-direction: column; gap: 10px; align-items: center;
}
.big span { font-size: 1rem; }
.big:hover { border-color: var(--accent); }
.center-text { text-align: center; }
.flat { font-size: .9rem; }
.flat label { display: flex; align-items: center; gap: 6px; }
.viewfinder { position: relative; background: #000; border-radius: 12px; overflow: hidden; }
.viewfinder video { display: block; width: 100%; max-height: 68vh; object-fit: contain; }
.viewfinder svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.live { fill: rgba(18, 163, 127, .25); stroke: #3ee0b4; stroke-linejoin: round; transition: fill .2s; }
.live.steady { fill: rgba(18, 163, 127, .45); stroke: #fff; }
.cam-hint {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: rgba(0, 0, 0, .6); color: #fff;
  padding: 6px 12px; border-radius: 16px; font-size: .85rem; white-space: nowrap; max-width: 92%; overflow: hidden; text-overflow: ellipsis;
}
.auto { display: flex; align-items: center; gap: 4px; font-size: .9rem; }
.warn { background: #fff4e5; border: 1px solid #f0c27a; color: #7a4b00; border-radius: 8px; padding: 8px 12px; font-size: .9rem; }
.center { justify-content: center; margin: 12px 0; }
.shutter { width: 64px; height: 64px; border-radius: 50%; border: 5px solid var(--accent); background: #fff; cursor: pointer; }
.shutter:active { background: var(--accent-soft); }
.stage { text-align: center; }
.preview { max-width: 100%; max-height: 60vh; box-shadow: 0 2px 12px rgba(0, 0, 0, .15); }
.review { text-align: left; }
.pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.page { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px; }
.page img { width: 100%; aspect-ratio: 3 / 4; object-fit: contain; background: #eef1f3; border-radius: 6px; }
</style>
