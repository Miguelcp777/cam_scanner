<script setup>
// Flujo: elegir (cámara / imágenes) → procesar cada página → revisar → guardar.
//  - Una página: foto → PageProcessor (recorte con lupa, filtro, giro, aplanado).
//  - Ráfaga ("Varias páginas") o varias imágenes importadas: se procesan solas y se revisan al final;
//    tocando una página se reajusta con PageProcessor.
// ?camera=1 abre la cámara; ?append=<idDoc> añade las páginas a un documento existente.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageProcessor from '../components/PageProcessor.vue'
import { createScanDoc, getDoc, saveDoc, uid } from '../lib/db'
import { autoPage, composeIdCard } from '../lib/process'
import { canvasToBlob, createLiveDetector, loadCV, releaseCanvas, rotateBlob } from '../lib/scan'
import { blobUrl, defaultScanName, isTouch, pending } from '../lib/util'

const route = useRoute()
const router = useRouter()

const step = ref('pick') // pick | camera | process | auto | review | edit
const busy = ref('')
const error = ref('')
const queue = ref([]) // [{ blob, hint }] pendientes de procesar paso a paso
const pages = ref([])
const name = ref(defaultScanName())
const folderId = ref(null)
const appendTo = ref(route.query.append || null)
const autoProgress = ref({ done: 0, total: 0 })
const editing = ref(-1) // índice de la página que se reajusta en la revisión

const video = ref(null)
const imgInput = ref(null)
const camInput = ref(null)
const touch = isTouch()
let stream = null

const backToList = () => (step.value = pages.value.length ? 'review' : 'pick')

// --- Cámara con detección de bordes en vivo ---
const liveQuad = ref(null) // esquinas en coordenadas del vídeo
const videoSize = ref({ w: 1, h: 1 })
const stable = ref(0)
const auto = ref(true)
// Modo de cámara: una página | ráfaga (varias seguidas) | carné/DNI (anverso + reverso en un A4)
const mode = ref(route.query.mode === 'id' ? 'id' : 'single')
const burst = computed(() => mode.value !== 'single') // ráfaga e ID capturan sin salir de la cámara
const shots = ref([]) // capturas de la ráfaga: [{ blob, hint, url }]
const flash = ref(false)
const STABLE_TICKS = 8 // ~1,2 s quieto → foto automática
let detector = null
let loopTimer = null
let capturing = false
let lastSig = null // firma de la última captura (evita repetir la misma hoja en ráfaga)

const livePolygon = computed(() => liveQuad.value?.map((p) => `${p.x},${p.y}`).join(' ') || '')
const cameraHint = computed(() => {
  const side = mode.value === 'id' ? (shots.value.length ? 'REVERSO: ' : 'ANVERSO: ') : ''
  if (!liveQuad.value) return side + (mode.value === 'id' ? 'encuadra la tarjeta sobre un fondo oscuro' : 'Buscando documento… Encuadra la hoja sobre un fondo que contraste.')
  if (burst.value && lastSig && !isNewPage()) return mode.value === 'id' ? 'Dale la vuelta a la tarjeta' : 'Cambia de hoja para la siguiente página'
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
    await nextTick()
    video.value.srcObject = stream
    await video.value.play().catch(() => {})
    const { cv } = await loadCV()
    detector = createLiveDetector(cv)
    detectLoop()
  } catch (e) {
    error.value = 'No se pudo acceder a la cámara: ' + (e.message || e.name) + '. Puedes importar imágenes.'
    backToList()
  }
}

const moved = (a, b, tol) => a.some((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) > tol)

// Miniatura 32×32 en grises de la zona del documento: si apenas cambia, es la misma hoja
const sigCanvas = document.createElement('canvas')
sigCanvas.width = sigCanvas.height = 32
function signature() {
  const v = video.value
  const q = liveQuad.value
  if (!q || !v.videoWidth) return null
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y)
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const ctx = sigCanvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(v, x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0, 0, 0, 32, 32)
  const d = ctx.getImageData(0, 0, 32, 32).data
  const g = new Uint8Array(1024)
  for (let i = 0; i < 1024; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3
  return g
}
function isNewPage() {
  const s = signature()
  if (!s || !lastSig) return true
  let diff = 0
  for (let i = 0; i < s.length; i++) diff += Math.abs(s[i] - lastSig[i])
  return diff / s.length > 9
}

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
    if (auto.value && stable.value >= STABLE_TICKS && (!burst.value || isNewPage())) {
      capture()
      return
    }
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
    releaseCanvas(c)
    const hint = liveQuad.value ? { pts: liveQuad.value, w: v.videoWidth } : null
    if (burst.value) {
      lastSig = signature()
      shots.value.push({ blob, hint, url: URL.createObjectURL(blob) })
      flash.value = true
      setTimeout(() => (flash.value = false), 180)
      stable.value = 0
      if (mode.value === 'id' && shots.value.length >= 2) return finishBurst() // anverso + reverso
      loopTimer = setTimeout(detectLoop, 400)
    } else {
      stopCamera()
      queue.value.push({ blob, hint })
      step.value = 'process'
    }
  } finally {
    capturing = false
  }
}

function cancelCamera() {
  stopCamera()
  shots.value.forEach((s) => URL.revokeObjectURL(s.url))
  shots.value = []
  lastSig = null
  backToList()
}

// Fin de la ráfaga: procesar todas las capturas
function finishBurst() {
  stopCamera()
  const list = shots.value.map(({ blob, hint, url }) => {
    URL.revokeObjectURL(url)
    return { blob, hint }
  })
  shots.value = []
  lastSig = null
  if (mode.value === 'id') processId(list)
  else processAll(list)
}

// Carné: cada cara recortada (color original, sin aplanar) y ambas a tamaño real en un A4
function processId(list) {
  if (!list.length) return backToList()
  step.value = 'auto'
  autoProgress.value = { done: 0, total: list.length }
  run('', async () => {
    const sides = []
    for (const item of list) {
      sides.push((await autoPage(item.blob, item.hint, { filter: 'original', flatten: false })).blob)
      autoProgress.value.done++
    }
    pages.value.push(await composeIdCard(sides))
    if (!appendTo.value && name.value.startsWith('Escaneo')) name.value = name.value.replace('Escaneo', 'Carné')
    step.value = 'review'
  })
}

function processAll(list) {
  if (!list.length) return backToList()
  step.value = 'auto'
  autoProgress.value = { done: 0, total: list.length }
  run('', async () => {
    for (const item of list) {
      pages.value.push(await autoPage(item.blob, item.hint))
      autoProgress.value.done++
    }
    step.value = 'review'
  })
}

// Una imagen: paso a paso; varias: automático y revisión al final
function addImages(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/')).map((blob) => ({ blob, hint: null }))
  if (!imgs.length) return
  if (imgs.length === 1) {
    queue.value.push(imgs[0])
    step.value = 'process'
  } else {
    processAll(imgs)
  }
}

function onProcessed(page) {
  pages.value.push({ id: uid(), text: '', ...page })
  queue.value.shift()
  if (queue.value.length) return
  // Tras una página hecha con la cámara, seguir escaneando es lo más habitual
  backToList()
}

function onDiscard() {
  queue.value.shift()
  if (!queue.value.length) backToList()
}

// --- Revisión ---
function movePage(i, d) {
  const p = pages.value
  ;[p[i], p[i + d]] = [p[i + d], p[i]]
}

function quickRotate(i) {
  run('Girando…', async () => {
    const p = pages.value[i]
    Object.assign(p, await rotateBlob(p.blob, 90), { rotation: ((p.rotation || 0) + 90) % 360 })
  })
}

function onEdited(page) {
  Object.assign(pages.value[editing.value], page)
  editing.value = -1
  step.value = 'review'
}

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

function systemCamera() {
  stopCamera()
  backToList()
  camInput.value.click()
}

onMounted(() => {
  if (pending.files.length) {
    const files = pending.files
    folderId.value = pending.folderId
    pending.files = []
    pending.folderId = null
    addImages(files)
  } else if (route.query.camera) {
    startCamera()
  }
})

onBeforeUnmount(() => {
  stopCamera()
  shots.value.forEach((s) => URL.revokeObjectURL(s.url))
})
</script>

<template>
  <div class="row head">
    <h1>{{ appendTo ? 'Añadir páginas' : 'Escanear' }}</h1>
    <span class="spacer" />
    <span v-if="pages.length" class="muted">{{ pages.length }} página(s)</span>
    <button v-if="pages.length && ['pick', 'camera'].includes(step)" class="btn" @click="stopCamera(); step = 'review'">Revisar ›</button>
  </div>

  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="busy" class="muted">⏳ {{ busy }}</p>

  <!-- Elegir origen -->
  <div v-if="step === 'pick' && !busy" class="pick">
    <button class="big" @click="startCamera">📷<span>Escanear con la cámara</span></button>
    <button class="big" @click="imgInput.click()">🖼️<span>Importar imágenes</span></button>
  </div>
  <p v-if="step === 'pick' && touch && !busy" class="muted center-text">
    <a href="#" @click.prevent="camInput.click()">Usar la cámara del sistema (sin detección en vivo)</a>
  </p>

  <!-- Cámara con detección en vivo -->
  <div v-show="step === 'camera'" class="camera">
    <div class="modes">
      <button :class="['mode', { on: mode === 'single' }]" @click="mode = 'single'">Una página</button>
      <button :class="['mode', { on: mode === 'burst' }]" @click="mode = 'burst'">Varias páginas</button>
      <button :class="['mode', { on: mode === 'id' }]" @click="mode = 'id'">🪪 Carné / DNI</button>
    </div>
    <div :class="['viewfinder', { flash }]">
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
      <button class="btn" @click="cancelCamera">Cancelar</button>
      <button class="shutter" title="Capturar" @click="capture" />
      <label class="auto"><input v-model="auto" type="checkbox" /> Auto</label>
    </div>
    <div v-if="burst && shots.length" class="burst">
      <img v-for="(s, i) in shots.slice(-4)" :key="i" :src="s.url" alt="" />
      <button class="btn primary" @click="finishBurst">{{ mode === 'id' ? 'Solo una cara ›' : `Hecho (${shots.length}) ›` }}</button>
    </div>
    <div class="row center">
      <button class="btn small" @click="stopCamera(); imgInput.click()">🖼️ Galería</button>
      <button v-if="touch" class="btn small" @click="systemCamera">📷 Cámara del sistema</button>
    </div>
  </div>

  <!-- Procesado paso a paso de la siguiente imagen -->
  <PageProcessor
    v-if="step === 'process' && queue.length"
    :key="queue.length + ':' + pages.length"
    :source="queue[0].blob"
    :hint="queue[0].hint"
    @done="onProcessed"
    @cancel="onDiscard"
  />

  <!-- Procesado automático (ráfaga / varias imágenes) -->
  <div v-if="step === 'auto'" class="card autoproc">
    <p>Procesando páginas… {{ autoProgress.done }} de {{ autoProgress.total }}</p>
    <div class="progress"><div :style="{ width: (autoProgress.done / autoProgress.total) * 100 + '%' }" /></div>
    <p class="muted">Bordes, perspectiva, aplanado y filtro Documento, de forma automática.</p>
  </div>

  <!-- Reajustar una página de la revisión -->
  <PageProcessor
    v-if="step === 'edit' && editing >= 0"
    :key="'edit-' + pages[editing].id"
    :source="pages[editing].original || pages[editing].blob"
    :is-original="!!pages[editing].original"
    :initial="pages[editing].original ? pages[editing] : null"
    done-label="✓ Guardar cambios"
    cancel-label="Cancelar"
    @done="onEdited"
    @cancel="editing = -1; step = 'review'"
  />

  <!-- Revisión -->
  <div v-if="step === 'review'" class="review">
    <p class="muted">Toca ✏️ para reajustar el recorte, el filtro o el giro de una página.</p>
    <div class="pages">
      <div v-for="(p, i) in pages" :key="p.id" :class="['page', { warn: p.detected === false }]">
        <img :src="blobUrl(p.blob)" alt="" @click="editing = i; step = 'edit'" />
        <p v-if="p.detected === false" class="warn-text">⚠ Bordes no detectados</p>
        <div class="row">
          <span class="muted">{{ i + 1 }}</span>
          <span class="spacer" />
          <button class="btn small" title="Editar" @click="editing = i; step = 'edit'">✏️ Editar</button>
          <button class="btn small" title="Girar" @click="quickRotate(i)">↻ Girar</button>
          <button class="btn small" :disabled="i === 0" @click="movePage(i, -1)">◀</button>
          <button class="btn small" :disabled="i === pages.length - 1" @click="movePage(i, 1)">▶</button>
          <button class="btn small danger" @click="pages.splice(i, 1)">🗑</button>
        </div>
      </div>
    </div>
    <div class="row">
      <button class="btn" @click="startCamera">📷 Escanear más</button>
      <button class="btn" @click="imgInput.click()">🖼️ Importar más</button>
      <span class="spacer" />
      <input v-if="!appendTo" v-model="name" type="text" placeholder="Nombre del documento" />
      <button class="btn primary" :disabled="!pages.length || !!busy" @click="save">💾 Guardar</button>
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
.modes { display: flex; justify-content: center; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.mode { border: 1px solid var(--border); background: var(--surface); padding: 6px 14px; border-radius: 16px; font: inherit; font-size: .9rem; cursor: pointer; }
.mode.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.viewfinder { position: relative; background: #000; border-radius: 12px; overflow: hidden; }
.viewfinder.flash::after { content: ''; position: absolute; inset: 0; background: #fff; opacity: .7; }
.viewfinder video { display: block; width: 100%; max-height: 64vh; object-fit: contain; }
.viewfinder svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.live { fill: rgba(18, 163, 127, .25); stroke: #3ee0b4; stroke-linejoin: round; transition: fill .2s; }
.live.steady { fill: rgba(18, 163, 127, .45); stroke: #fff; }
.cam-hint {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); background: rgba(0, 0, 0, .6); color: #fff;
  padding: 6px 12px; border-radius: 16px; font-size: .85rem; white-space: nowrap; max-width: 92%; overflow: hidden; text-overflow: ellipsis;
}
.center { justify-content: center; margin: 12px 0; }
.shutter { width: 64px; height: 64px; border-radius: 50%; border: 5px solid var(--accent); background: #fff; cursor: pointer; }
.shutter:active { background: var(--accent-soft); }
.auto { display: flex; align-items: center; gap: 4px; font-size: .9rem; }
.burst { display: flex; align-items: center; gap: 6px; justify-content: center; margin-bottom: 8px; }
.burst img { width: 44px; height: 58px; object-fit: cover; border-radius: 4px; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .3); }
.autoproc { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.page { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px; }
.page.warn { border-color: #f0c27a; }
.page img { width: 100%; aspect-ratio: 3 / 4; object-fit: contain; background: #eef1f3; border-radius: 6px; cursor: pointer; }
.warn-text { margin: 4px 0; font-size: .75rem; color: #7a4b00; }
@media (max-width: 720px) {
  .pages { grid-template-columns: repeat(2, 1fr); }
  .page .row { gap: 4px; }
}
</style>
