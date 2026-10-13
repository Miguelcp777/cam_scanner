<script setup>
// Colocar firmas sobre las páginas: tocar una firma la añade a la página actual;
// arrastrar para mover, esquina inferior derecha para cambiar el tamaño.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SignaturePad from '../components/SignaturePad.vue'
import { getDoc, listSignatures, saveSignature, uid } from '../lib/db'
import { pageImages } from '../lib/pages'
import { stampSignatures } from '../lib/pdf'
import { blobUrl, savePdf } from '../lib/util'

const route = useRoute()
const router = useRouter()
const doc = ref(null)
const pages = ref([]) // [{ url, aspect }] aspect = alto/ancho
const sigs = ref([])
const current = ref(0)
const placements = ref([])
const drawing = ref(false)
const busy = ref('')
const error = ref('')
const stage = ref(null)

const here = computed(() => placements.value.filter((p) => p.page === current.value))
const sigById = computed(() => Object.fromEntries(sigs.value.map((s) => [s.id, s])))

async function aspectOf(blob) {
  const bmp = await createImageBitmap(blob)
  const a = bmp.height / bmp.width
  bmp.close()
  return a
}

onMounted(async () => {
  busy.value = 'Cargando páginas…'
  try {
    doc.value = await getDoc(route.query.id)
    sigs.value = await listSignatures()
    const imgs = await pageImages(doc.value, { maxSide: 1400 })
    pages.value = await Promise.all(imgs.map(async (b) => ({ url: blobUrl(b), aspect: await aspectOf(b) })))
  } catch (e) {
    error.value = 'No se pudo abrir el documento: ' + (e.message || e)
  } finally {
    busy.value = ''
  }
})

function place(sig) {
  const w = 0.3
  const h = w * (sig.height / sig.width) / pages.value[current.value].aspect
  placements.value.push({ id: uid(), page: current.value, sigId: sig.id, x: 0.5 - w / 2, y: 0.75 - h / 2, w, h })
}

async function onNewSig(sig) {
  const saved = await saveSignature(sig)
  sigs.value.unshift(saved)
  drawing.value = false
  place(saved)
}

// Arrastre en fracciones de la página
let drag = null
function startDrag(p, mode, e) {
  e.target.setPointerCapture(e.pointerId)
  const r = stage.value.getBoundingClientRect()
  drag = { p, mode, sx: e.clientX, sy: e.clientY, start: { ...p }, r }
}
function onMove(e) {
  if (!drag) return
  const { p, mode, start, r } = drag
  const dx = (e.clientX - drag.sx) / r.width
  const dy = (e.clientY - drag.sy) / r.height
  if (mode === 'move') {
    p.x = Math.min(1 - p.w, Math.max(0, start.x + dx))
    p.y = Math.min(1 - p.h, Math.max(0, start.y + dy))
  } else {
    const ratio = start.h / start.w
    p.w = Math.min(1 - p.x, Math.max(0.05, start.w + dx))
    p.h = p.w * ratio
    if (p.y + p.h > 1) {
      p.h = 1 - p.y
      p.w = p.h / ratio
    }
  }
}
const endDrag = () => (drag = null)

const remove = (p) => (placements.value = placements.value.filter((x) => x !== p))

async function apply() {
  busy.value = 'Firmando…'
  error.value = ''
  try {
    const blob = await stampSignatures(doc.value, placements.value, sigById.value)
    const out = await savePdf({ name: `${doc.value.name} (firmado)`, blob, folderId: doc.value.folderId })
    router.replace({ path: '/file/detail', query: { id: out.id } })
  } catch (e) {
    error.value = 'No se pudo firmar: ' + (e.message || e)
    busy.value = ''
  }
}
</script>

<template>
  <div class="row head">
    <h1>✍️ Firmar{{ doc ? `: ${doc.name}` : '' }}</h1>
    <span class="spacer" />
    <button class="btn primary" :disabled="!placements.length || !!busy" @click="apply">✓ Aplicar firma ({{ placements.length }})</button>
  </div>
  <p v-if="busy" class="muted">⏳ {{ busy }}</p>
  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="pages.length">
    <div class="palette">
      <span class="muted">Toca una firma para colocarla:</span>
      <button v-for="s in sigs" :key="s.id" class="sigbtn" @click="place(s)"><img :src="blobUrl(s.blob)" alt="Firma" /></button>
      <button class="btn small" @click="drawing = !drawing">➕ Nueva</button>
    </div>
    <SignaturePad v-if="drawing" class="newpad" @save="onNewSig" @cancel="drawing = false" />

    <div class="layout">
      <div class="thumbs">
        <button v-for="(p, i) in pages" :key="i" :class="['thumb', { on: i === current }]" @click="current = i">
          <img :src="p.url" alt="" />
          <span>{{ i + 1 }}<template v-if="placements.some((x) => x.page === i)"> ✍️</template></span>
        </button>
      </div>
      <div ref="stage" class="stage" @pointermove="onMove" @pointerup="endDrag" @pointercancel="endDrag">
        <img :src="pages[current].url" alt="" draggable="false" />
        <div
          v-for="p in here"
          :key="p.id"
          class="placed"
          :style="{ left: p.x * 100 + '%', top: p.y * 100 + '%', width: p.w * 100 + '%', height: p.h * 100 + '%' }"
          @pointerdown.prevent="startDrag(p, 'move', $event)"
        >
          <img :src="blobUrl(sigById[p.sigId].blob)" alt="" draggable="false" />
          <button class="x" title="Quitar" @pointerdown.stop @click="remove(p)">✕</button>
          <span class="resize" @pointerdown.stop.prevent="startDrag(p, 'resize', $event)" />
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.palette { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.sigbtn { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px; cursor: pointer; }
.sigbtn:hover { border-color: var(--accent); }
.sigbtn img { height: 36px; max-width: 140px; object-fit: contain; display: block; }
.newpad { margin-bottom: 12px; }
.layout { display: flex; gap: 14px; align-items: flex-start; }
.thumbs { display: flex; flex-direction: column; gap: 8px; width: 90px; flex-shrink: 0; max-height: 75vh; overflow: auto; }
.thumb { border: 2px solid transparent; border-radius: 8px; background: none; padding: 2px; cursor: pointer; font: inherit; font-size: .8rem; }
.thumb.on { border-color: var(--accent); }
.thumb img { width: 100%; display: block; border-radius: 4px; box-shadow: 0 1px 4px rgba(0, 0, 0, .15); }
.stage { position: relative; flex: 1; max-width: 700px; touch-action: none; user-select: none; box-shadow: 0 2px 12px rgba(0, 0, 0, .15); }
.stage > img { width: 100%; display: block; }
.placed { position: absolute; outline: 2px dashed var(--accent); cursor: move; touch-action: none; }
.placed img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.x { position: absolute; top: -14px; right: -14px; width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--danger); color: #fff; cursor: pointer; font-size: .8rem; }
.resize { position: absolute; right: -9px; bottom: -9px; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); border: 3px solid #fff; cursor: nwse-resize; }
@media (max-width: 720px) {
  .layout { flex-direction: column-reverse; }
  .thumbs { flex-direction: row; width: 100%; max-height: none; }
  .thumb { width: 64px; flex-shrink: 0; }
  .stage { width: 100%; }
}
</style>
