<script setup>
// Procesado interactivo de una página: recorte (con lupa) → filtro, giro y aplanado.
// Emite 'done' con la página lista ({ blob, width, height, original, points, filter, flatten, rotation })
// o 'cancel'. Sirve tanto para páginas nuevas como para reeditar una guardada (initial + isOriginal).
import { onBeforeUnmount, onMounted, ref } from 'vue'
import CropEditor from './CropEditor.vue'
import { canvasToPage, cropPage, DEFAULT_FILTER, DEFAULT_FLATTEN, findCorners, loadSource, renderPage } from '../lib/process'
import { applyFilter, FILTERS, fullCorners, releaseCanvas } from '../lib/scan'

const props = defineProps({
  source: { type: Blob, required: true },
  isOriginal: Boolean, // source es el "original" guardado de una página (no recomprimir)
  initial: { type: Object, default: null }, // { points, filter, flatten, rotation } de una página guardada
  hint: { type: Object, default: null }, // esquinas vistas en vivo por la cámara
  doneLabel: { type: String, default: '✓ Añadir página' },
  cancelLabel: { type: String, default: 'Descartar' },
})
const emit = defineEmits(['done', 'cancel'])

const step = ref('loading') // loading | crop | filter
const busy = ref('Cargando…')
const error = ref('')
const url = ref('')
const size = ref({ w: 1, h: 1 })
const points = ref([])
const detected = ref(true)
const edited = ref(false)
const filter = ref(props.initial?.filter || DEFAULT_FILTER)
const flatten = ref(props.initial?.flatten ?? DEFAULT_FLATTEN)
const rotation = ref(props.initial?.rotation || 0)
const flattened = ref('')
const preview = ref('')
const thumbs = ref({}) // miniatura de cada filtro aplicada a esta página

// Canvas fuera de la reactividad; se liberan al terminar (límite de memoria de iOS)
const c = { src: null, warped: null, out: null }
let originalP = null // JPEG del original (se comprime en segundo plano)

async function task(label, fn) {
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

onMounted(() =>
  task('Detectando bordes…', async () => {
    const s = await loadSource(props.source, { isOriginal: props.isOriginal })
    c.src = s.canvas
    originalP = s.originalP
    url.value = URL.createObjectURL(props.source) // para el recorte basta la foto tal cual
    size.value = { w: c.src.width, h: c.src.height }
    if (props.initial?.points) {
      points.value = props.initial.points.map((p) => ({ ...p }))
      edited.value = true // respetar el recorte guardado
    } else {
      const r = await findCorners(c.src, props.hint)
      points.value = r.points
      detected.value = r.detected
    }
    step.value = 'crop'
  }),
)

function setPoints(p) {
  points.value = p
  edited.value = true
}

async function recrop() {
  releaseCanvas(c.warped)
  const r = await cropPage(c.src, points.value, { snap: !edited.value && detected.value, flatten: flatten.value })
  c.warped = r.warped
  points.value = r.points
  flattened.value = r.flattened
}

// Miniaturas de todos los filtros sobre una copia pequeña de la página (como la tira de CamScanner).
// Se generan en segundo plano: los botones funcionan mientras tanto; una tanda nueva anula la anterior.
let thumbRun = 0
async function makeThumbs() {
  const run = ++thumbRun
  thumbs.value = {}
  const w = c.warped
  if (!w) return
  const k = Math.min(1, 220 / Math.max(w.width, w.height))
  const small = document.createElement('canvas')
  small.width = Math.max(1, Math.round(w.width * k))
  small.height = Math.max(1, Math.round(w.height * k))
  small.getContext('2d').drawImage(w, 0, 0, small.width, small.height)
  const t = {}
  try {
    for (const f of FILTERS) {
      if (run !== thumbRun) return
      const r = await applyFilter(small, f.id)
      t[f.id] = r.toDataURL('image/jpeg', 0.7)
      releaseCanvas(r)
      thumbs.value = { ...t } // aparecen una a una
    }
  } finally {
    releaseCanvas(small)
  }
}

async function render() {
  releaseCanvas(c.out)
  c.out = await renderPage(c.warped, filter.value, rotation.value)
  preview.value = c.out.toDataURL('image/jpeg', 0.7)
}

const confirmCrop = () =>
  task('Corrigiendo perspectiva…', async () => {
    await recrop()
    await render()
    step.value = 'filter'
    makeThumbs()
  })

const setFilter = (f) =>
  task('Aplicando filtro…', async () => {
    filter.value = f
    await render()
  })

const rotate = (d) =>
  task('Girando…', async () => {
    rotation.value = (rotation.value + d + 360) % 360
    await render()
  })

const toggleFlatten = () =>
  task('Aplanando el papel…', async () => {
    await recrop()
    await render()
    makeThumbs()
  })

const finish = () =>
  task('Guardando página…', async () => {
    const page = await canvasToPage(c.out)
    emit('done', { ...page, original: await originalP, points: points.value, filter: filter.value, flatten: flatten.value, rotation: rotation.value })
  })

onBeforeUnmount(() => {
  thumbRun++
  Object.values(c).forEach(releaseCanvas)
  URL.revokeObjectURL(url.value)
})
</script>

<template>
  <div class="proc">
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="busy" class="muted">⏳ {{ busy }}</p>

    <div v-if="step === 'crop' && !busy">
      <p v-if="detected" class="muted">Ajusta las esquinas al borde del documento. Mantén pulsada una esquina para ver la lupa.</p>
      <p v-else class="warn">No se detectó el borde del documento. Arrastra las esquinas a mano o repite la foto sobre un fondo que contraste con el papel.</p>
      <CropEditor :model-value="points" :src="url" :width="size.w" :height="size.h" @update:model-value="setPoints" />
      <div class="row center">
        <button class="btn danger" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button class="btn" @click="setPoints(fullCorners(size.w, size.h))">Imagen completa</button>
        <button class="btn primary" @click="confirmCrop">Recortar ›</button>
      </div>
    </div>

    <div v-if="step === 'filter'">
      <img :src="preview" class="preview" alt="Vista previa" />
      <div class="filters" role="listbox" aria-label="Filtros">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          role="option"
          :aria-selected="filter === f.id"
          :class="['fbtn', { on: filter === f.id }]"
          :disabled="!!busy"
          @click="setFilter(f.id)"
        >
          <span class="thumb"><img v-if="thumbs[f.id]" :src="thumbs[f.id]" alt="" /></span>
          <span class="flabel">{{ f.label }}</span>
        </button>
      </div>
      <div class="row center">
        <button class="btn" title="Girar a la izquierda" :disabled="!!busy" @click="rotate(-90)">↺ Girar</button>
        <button class="btn" title="Girar a la derecha" :disabled="!!busy" @click="rotate(90)">↻ Girar</button>
      </div>
      <div class="row center flat">
        <label><input v-model="flatten" type="checkbox" :disabled="!!busy" @change="toggleFlatten" /> Aplanar curvatura</label>
        <span v-if="flatten && flattened" class="muted">· corregidos {{ flattened }}</span>
        <span v-else-if="flatten" class="muted">· sin curvatura apreciable</span>
      </div>
      <div class="row center">
        <button class="btn" :disabled="!!busy" @click="step = 'crop'">‹ Recortar</button>
        <button class="btn primary" :disabled="!!busy" @click="finish">{{ doneLabel }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.proc { text-align: center; }
.center { justify-content: center; margin: 12px 0; }
.preview { max-width: 100%; max-height: 58vh; box-shadow: 0 2px 12px rgba(0, 0, 0, .15); }
.flat { font-size: .9rem; }
.filters { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 8px; margin: 10px 0 0; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
.fbtn { flex: 0 0 auto; width: 76px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px; border: 2px solid transparent; border-radius: 10px; background: var(--surface); font: inherit; cursor: pointer; scroll-snap-align: start; }
.fbtn.on { border-color: var(--accent); background: var(--accent-soft); }
.fbtn:disabled { opacity: .6; }
.thumb { width: 64px; height: 84px; display: flex; align-items: center; justify-content: center; background: var(--border); border-radius: 6px; overflow: hidden; }
.thumb img { max-width: 100%; max-height: 100%; }
.flabel { font-size: .72rem; line-height: 1.15; text-align: center; }
.fbtn.on .flabel { color: var(--accent-dark); font-weight: 600; }
.flat label { display: flex; align-items: center; gap: 6px; }
.warn { background: #fff4e5; border: 1px solid #f0c27a; color: #7a4b00; border-radius: 8px; padding: 8px 12px; font-size: .9rem; }
</style>
