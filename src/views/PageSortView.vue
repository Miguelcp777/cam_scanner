<script setup>
// Organizar páginas (/tools/pagesort?id=…): reordenar arrastrando, girar y eliminar. Escaneos y PDF.
// El arrastre usa eventos de puntero (funciona con el dedo en iOS, donde el drag&drop HTML5 no sirve).
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import { getDoc, saveDoc } from '../lib/db'
import { pageImages } from '../lib/pages'
import { rearrangePdf } from '../lib/pdf'
import { pdfInfo } from '../lib/render'
import { rotateBlob } from '../lib/scan'
import { blobUrl } from '../lib/util'

const route = useRoute()
const router = useRouter()
const selected = ref(route.query.id ? [route.query.id] : [])
const doc = ref(null)
const items = ref([]) // [{ key, index (página original), rotate, url }]
const busy = ref('')
const error = ref('')
const dragKey = ref(null)

const changed = computed(() => items.value.some((it, i) => it.index !== i || it.rotate) || items.value.length !== (doc.value?.pageCount ?? 0))

watch(
  selected,
  async (s) => {
    doc.value = null
    items.value = []
    if (!s[0]) return
    busy.value = 'Cargando páginas…'
    try {
      const d = await getDoc(s[0])
      const blobs = d.kind === 'scan' ? d.pages.map((p) => p.blob) : await pageImages(d, { maxSide: 500 })
      items.value = blobs.map((b, i) => ({ key: `${i}`, index: i, rotate: 0, url: blobUrl(b) }))
      doc.value = d
    } catch (e) {
      error.value = 'No se pudo abrir el documento: ' + (e.message || e)
    } finally {
      busy.value = ''
    }
  },
  { immediate: true },
)

// --- Arrastrar desde el asa ⠿ ---
function startDrag(it, e) {
  e.target.setPointerCapture(e.pointerId)
  dragKey.value = it.key
}
function onDrag(e) {
  if (!dragKey.value) return
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-idx]')
  if (!el) return
  const to = Number(el.dataset.idx)
  const from = items.value.findIndex((x) => x.key === dragKey.value)
  if (from === to || from < 0) return
  const [moved] = items.value.splice(from, 1)
  items.value.splice(to, 0, moved)
}
const endDrag = () => (dragKey.value = null)

const rotate = (it) => (it.rotate = (it.rotate + 90) % 360)
const remove = (i) => items.value.length > 1 && items.value.splice(i, 1)
function move(i, d) {
  const a = items.value
  ;[a[i], a[i + d]] = [a[i + d], a[i]]
}

async function save() {
  busy.value = 'Guardando…'
  error.value = ''
  try {
    const d = doc.value
    if (d.kind === 'scan') {
      const pages = []
      for (const it of items.value) {
        const p = { ...d.pages[it.index] }
        if (it.rotate) Object.assign(p, await rotateBlob(p.blob, it.rotate), { rotation: ((p.rotation || 0) + it.rotate) % 360 })
        pages.push(p)
      }
      d.pages = pages
    } else {
      d.pdf = await rearrangePdf(d.pdf, items.value.map(({ index, rotate }) => ({ index, rotate })))
      const info = await pdfInfo(d.pdf).catch(() => null)
      d.thumb = info?.thumb ?? d.thumb
      d.pageCount = items.value.length
      d.text = '' // el texto extraído ya no corresponde al nuevo orden
    }
    await saveDoc(d)
    router.replace({ path: '/file/detail', query: { id: d.id } })
  } catch (e) {
    error.value = 'No se pudo guardar: ' + (e.message || e)
    busy.value = ''
  }
}
</script>

<template>
  <div class="row head">
    <h1>🗂 Organizar páginas</h1>
    <span class="spacer" />
    <button v-if="doc" class="btn primary" :disabled="!!busy || !changed" @click="save">💾 Guardar</button>
  </div>
  <template v-if="!route.query.id">
    <p class="muted">Elige un documento:</p>
    <DocPicker v-model="selected" />
  </template>
  <p v-if="busy" class="muted">⏳ {{ busy }}</p>
  <p v-if="error" class="error">{{ error }}</p>

  <template v-if="doc && !busy">
    <p class="muted">{{ doc.name }} — arrastra desde <b>⠿</b> para reordenar. ↻ gira, 🗑 quita la página.</p>
    <div class="grid" @pointermove="onDrag" @pointerup="endDrag" @pointercancel="endDrag">
      <div v-for="(it, i) in items" :key="it.key" :data-idx="i" :class="['card', { dragging: dragKey === it.key }]">
        <div class="thumb"><img :src="it.url" :style="{ transform: `rotate(${it.rotate}deg)` }" alt="" draggable="false" /></div>
        <div class="bar">
          <span class="handle" title="Arrastrar" @pointerdown.prevent="startDrag(it, $event)">⠿</span>
          <span class="num">{{ i + 1 }}</span>
          <span class="spacer" />
          <button class="btn small" title="Mover antes" :disabled="i === 0" @click="move(i, -1)">◀</button>
          <button class="btn small" title="Mover después" :disabled="i === items.length - 1" @click="move(i, 1)">▶</button>
          <button class="btn small" title="Girar" @click="rotate(it)">↻</button>
          <button class="btn small danger" title="Quitar" :disabled="items.length === 1" @click="remove(i)">🗑</button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin-top: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px; transition: transform .1s; }
.card.dragging { border-color: var(--accent); box-shadow: 0 4px 16px rgba(0, 0, 0, .2); transform: scale(1.03); }
.thumb { aspect-ratio: 3 / 4; background: #eef1f3; border-radius: 6px; display: grid; place-items: center; overflow: hidden; }
.thumb img { max-width: 100%; max-height: 100%; transition: transform .2s; }
.bar { display: flex; align-items: center; gap: 3px; margin-top: 6px; flex-wrap: wrap; }
.handle { cursor: grab; touch-action: none; font-size: 1.3rem; padding: 2px 8px; border-radius: 6px; background: var(--bg); user-select: none; }
.num { font-weight: 600; font-size: .85rem; }
@media (max-width: 720px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
