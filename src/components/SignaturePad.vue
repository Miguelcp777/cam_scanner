<script setup>
// Lienzo para dibujar la firma con el dedo o el ratón. Emite { blob (PNG recortado, fondo transparente), width, height }.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { canvasToBlob, releaseCanvas } from '../lib/scan'

const emit = defineEmits(['save', 'cancel'])
const canvas = ref(null)
const color = ref('#1a2b6d')
const empty = ref(true)
let ctx = null
let last = null
let mid = null

function resize() {
  const c = canvas.value
  const dpr = window.devicePixelRatio || 1
  const { width, height } = c.getBoundingClientRect()
  c.width = Math.round(width * dpr)
  c.height = Math.round(height * dpr)
  ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.lineCap = ctx.lineJoin = 'round'
  empty.value = true
}

const pos = (e) => {
  const r = canvas.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function down(e) {
  canvas.value.setPointerCapture(e.pointerId)
  last = mid = pos(e)
  ctx.fillStyle = color.value
  ctx.beginPath()
  ctx.arc(last.x, last.y, 1.4, 0, Math.PI * 2)
  ctx.fill()
  empty.value = false
}

// Curvas cuadráticas entre puntos medios: trazo suave
function move(e) {
  if (!last) return
  const p = pos(e)
  const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }
  ctx.strokeStyle = color.value
  ctx.lineWidth = e.pointerType === 'pen' && e.pressure ? 1.5 + e.pressure * 2.5 : 2.8
  ctx.beginPath()
  ctx.moveTo(mid.x, mid.y)
  ctx.quadraticCurveTo(last.x, last.y, m.x, m.y)
  ctx.stroke()
  last = p
  mid = m
}

const up = () => (last = null)

function clear() {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.restore()
  empty.value = true
}

// Recorta a los píxeles dibujados
async function save() {
  const c = canvas.value
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return
  const pad = 6
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  const blob = await canvasToBlob(out, 'image/png')
  emit('save', { blob, width: out.width, height: out.height })
  releaseCanvas(out)
}

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => window.removeEventListener('resize', resize))
</script>

<template>
  <div class="pad-wrap">
    <canvas ref="canvas" class="pad" @pointerdown.prevent="down" @pointermove.prevent="move" @pointerup="up" @pointercancel="up" />
    <span v-if="empty" class="hint">Firma aquí</span>
    <div class="row">
      <button v-for="c in ['#1a2b6d', '#111111', '#b3261e']" :key="c" :class="['swatch', { on: color === c }]" :style="{ background: c }" :title="c" @click="color = c" />
      <span class="spacer" />
      <button class="btn" @click="clear">Borrar</button>
      <button class="btn" @click="$emit('cancel')">Cancelar</button>
      <button class="btn primary" :disabled="empty" @click="save">Guardar firma</button>
    </div>
  </div>
</template>

<style scoped>
.pad-wrap { position: relative; display: flex; flex-direction: column; gap: 10px; }
.pad { width: 100%; height: 220px; background: #fff; border: 2px dashed var(--border); border-radius: 12px; touch-action: none; cursor: crosshair; }
.hint { position: absolute; top: 95px; left: 0; right: 0; text-align: center; color: var(--muted); pointer-events: none; font-size: 1.2rem; }
.swatch { width: 26px; height: 26px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px var(--border); cursor: pointer; }
.swatch.on { box-shadow: 0 0 0 2px var(--accent); }
</style>
