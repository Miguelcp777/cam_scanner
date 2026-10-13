<script setup>
// Ocultar datos sensibles (/tools/redaction?id=…): recuadros negros dibujados a mano o detectados por
// palabra / patrón. El resultado es un documento NUEVO con las páginas como imágenes: el texto tapado
// no queda en ninguna capa (ni se guarda la foto original), así que no se puede recuperar.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import { createScanDoc, getDoc, uid } from '../lib/db'
import { pageImages, pageLayouts } from '../lib/pages'
import { findSensitive, PATTERNS } from '../lib/redact'
import { canvasToBlob, loadImage, releaseCanvas } from '../lib/scan'
import { blobUrl } from '../lib/util'

const route = useRoute()
const router = useRouter()
const selected = ref(route.query.id ? [route.query.id] : [])
const doc = ref(null)
const pages = ref([]) // [{ blob, url, w, h, boxes: [{x,y,w,h}] }] (coordenadas de la imagen)
const current = ref(0)
const busy = ref('')
const progress = ref(0)
const error = ref('')
const info = ref('')
const terms = ref('')
const pats = ref(['email', 'phone', 'id', 'iban'])
const sel = ref(-1)
const svg = ref(null)

const page = computed(() => pages.value[current.value])
const total = computed(() => pages.value.reduce((n, p) => n + p.boxes.length, 0))

async function sizeOf(blob) {
  const b = await createImageBitmap(blob)
  const s = { w: b.width, h: b.height }
  b.close()
  return s
}

watch(
  selected,
  async (s) => {
    doc.value = null
    pages.value = []
    if (!s[0]) return
    busy.value = 'Cargando páginas…'
    try {
      const d = await getDoc(s[0])
      const blobs = d.kind === 'scan' ? d.pages.map((p) => p.blob) : await pageImages(d, { maxSide: 2000 })
      pages.value = await Promise.all(blobs.map(async (blob) => ({ blob, url: blobUrl(blob), ...(await sizeOf(blob)), boxes: [] })))
      current.value = 0
      doc.value = d
    } catch (e) {
      error.value = 'No se pudo abrir el documento: ' + (e.message || e)
    } finally {
      busy.value = ''
    }
  },
  { immediate: true },
)

// --- Dibujar recuadros con el dedo o el ratón ---
let drawing = null
function toImg(e) {
  const pt = svg.value.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  return pt.matrixTransform(svg.value.getScreenCTM().inverse())
}
function down(e) {
  if (e.target.dataset.box != null) {
    sel.value = Number(e.target.dataset.box)
    return
  }
  sel.value = -1
  try {
    svg.value.setPointerCapture(e.pointerId)
  } catch {} // sin captura el dibujo sigue funcionando mientras el dedo no salga de la página
  const p = toImg(e)
  drawing = { x0: p.x, y0: p.y }
  page.value.boxes.push({ x: p.x, y: p.y, w: 0, h: 0 })
}
function move(e) {
  if (!drawing) return
  const p = toImg(e)
  const b = page.value.boxes.at(-1)
  b.x = Math.min(drawing.x0, p.x)
  b.y = Math.min(drawing.y0, p.y)
  b.w = Math.abs(p.x - drawing.x0)
  b.h = Math.abs(p.y - drawing.y0)
}
function up() {
  if (!drawing) return
  drawing = null
  const b = page.value.boxes.at(-1)
  if (b.w < page.value.w * 0.01 || b.h < page.value.h * 0.005) page.value.boxes.pop() // toque sin arrastrar
}
function removeSel() {
  page.value.boxes.splice(sel.value, 1)
  sel.value = -1
}

// --- Detección automática ---
async function detect() {
  busy.value = 'Buscando datos…'
  error.value = ''
  info.value = ''
  progress.value = 0
  try {
    const layouts = await pageLayouts(doc.value, (p) => (progress.value = p))
    let n = 0
    layouts.forEach((l, i) => {
      const p = pages.value[i]
      const k = p.w / l.width // de coordenadas del texto a píxeles de la imagen
      for (const b of findSensitive(l, { terms: terms.value, patterns: pats.value })) {
        p.boxes.push({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k })
        n++
      }
    })
    info.value = n ? `Tapados ${n} dato(s). Revisa cada página: la detección puede fallar.` : 'No se encontraron datos con esos criterios.'
  } catch (e) {
    error.value = 'Error al buscar: ' + (e.message || e)
  } finally {
    busy.value = ''
  }
}

// --- Aplicar: nuevo documento con los recuadros incrustados en las imágenes ---
async function apply() {
  busy.value = 'Generando documento…'
  error.value = ''
  try {
    const out = []
    for (const p of pages.value) {
      const img = await loadImage(p.blob)
      const c = document.createElement('canvas')
      c.width = p.w
      c.height = p.h
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      URL.revokeObjectURL(img.src)
      x.fillStyle = '#000'
      for (const b of p.boxes) x.fillRect(b.x, b.y, b.w, b.h)
      out.push({ id: uid(), blob: await canvasToBlob(c, 'image/jpeg', 0.9), width: c.width, height: c.height, text: '' })
      releaseCanvas(c)
    }
    const d = await createScanDoc({ name: `${doc.value.name} (datos ocultos)`, pages: out, folderId: doc.value.folderId })
    router.replace({ path: '/file/detail', query: { id: d.id } })
  } catch (e) {
    error.value = 'No se pudo generar: ' + (e.message || e)
    busy.value = ''
  }
}
</script>

<template>
  <div class="row head">
    <h1>⬛ Ocultar datos</h1>
    <span class="spacer" />
    <button v-if="doc" class="btn primary" :disabled="!!busy || !total" @click="apply">✓ Crear copia con datos ocultos ({{ total }})</button>
  </div>
  <template v-if="!route.query.id">
    <p class="muted">Elige un documento:</p>
    <DocPicker v-model="selected" />
  </template>
  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="doc">
    <section class="card auto">
      <b>Tapar automáticamente</b>
      <input v-model="terms" type="text" placeholder="Palabras o frases a tapar, separadas por comas (opcional)" />
      <div class="pats">
        <label v-for="(p, k) in PATTERNS" :key="k"><input v-model="pats" type="checkbox" :value="k" /> {{ p.label }}</label>
      </div>
      <div class="row">
        <button class="btn" :disabled="!!busy || (!terms.trim() && !pats.length)" @click="detect">🔍 Buscar y tapar</button>
        <span v-if="doc.kind === 'scan'" class="muted small">En documentos escaneados se aplica OCR (tarda unos segundos por página).</span>
      </div>
      <div v-if="busy.startsWith('Buscando')" class="progress"><div :style="{ width: progress * 100 + '%' }" /></div>
      <p v-if="info" class="muted small">{{ info }}</p>
    </section>

    <p class="muted small">También puedes <b>arrastrar el dedo</b> sobre la página para dibujar un recuadro. Toca un recuadro para quitarlo.</p>
    <div class="row pager">
      <button class="btn small" :disabled="current === 0" @click="current--; sel = -1">‹</button>
      <span>Página {{ current + 1 }} de {{ pages.length }} · {{ page?.boxes.length || 0 }} recuadro(s)</span>
      <button class="btn small" :disabled="current >= pages.length - 1" @click="current++; sel = -1">›</button>
      <span class="spacer" />
      <button v-if="sel >= 0" class="btn small danger" @click="removeSel">Quitar recuadro</button>
      <button v-if="page?.boxes.length" class="btn small" @click="page.boxes = []; sel = -1">Quitar todos</button>
    </div>

    <div v-if="page" class="stage">
      <img :src="page.url" alt="" draggable="false" />
      <svg ref="svg" :viewBox="`0 0 ${page.w} ${page.h}`" preserveAspectRatio="none" @pointerdown.prevent="down" @pointermove="move" @pointerup="up" @pointercancel="up">
        <rect
          v-for="(b, i) in page.boxes"
          :key="i"
          :data-box="i"
          :x="b.x"
          :y="b.y"
          :width="b.w"
          :height="b.h"
          :class="['box', { sel: sel === i }]"
          :style="{ strokeWidth: page.w / 250 }"
        />
      </svg>
    </div>
  </template>
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; }
.auto { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.pats { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .9rem; }
.pats label { display: flex; align-items: center; gap: 4px; }
.small { font-size: .82rem; margin: 0; }
.pager { margin: 8px 0; }
.stage { position: relative; max-width: 720px; margin: 0 auto; touch-action: none; user-select: none; box-shadow: 0 2px 12px rgba(0, 0, 0, .15); }
.stage img { display: block; width: 100%; }
.stage svg { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; }
.box { fill: #000; stroke: transparent; }
.box.sel { fill: rgba(0, 0, 0, .7); stroke: var(--danger); }
</style>
