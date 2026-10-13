<script setup>
// Editor de recorte: 4 esquinas arrastrables sobre la imagen, en coordenadas de la imagen original.
// Al arrastrar una esquina aparece una lupa con zoom (como CamScanner) para ajustarla con precisión;
// el punto se mueve de forma relativa al dedo, así el dedo no tapa la esquina.
import { computed, ref } from 'vue'

const props = defineProps({ src: String, width: Number, height: Number, modelValue: Array })
const emit = defineEmits(['update:modelValue'])

const svg = ref(null)
const dragging = ref(-1)
const dispScale = ref(1) // píxeles en pantalla por píxel de imagen
const LOUPE = 132 // diámetro de la lupa en px de pantalla
const ZOOM = 4

const r = computed(() => Math.max(props.width, props.height) * 0.018)
const polygon = computed(() => props.modelValue.map((p) => `${p.x},${p.y}`).join(' '))
const active = computed(() => (dragging.value >= 0 ? props.modelValue[dragging.value] : null))

// Lupa en la esquina superior contraria al punto; si el punto está arriba, en la inferior
const loupeStyle = computed(() => {
  const p = active.value
  if (!p) return {}
  const right = p.x < props.width / 2
  const bottom = p.y < props.height * 0.35
  return { [right ? 'right' : 'left']: '8px', [bottom ? 'bottom' : 'top']: '8px', width: `${LOUPE}px`, height: `${LOUPE}px` }
})

// Ventana de la imagen que muestra la lupa, centrada en el punto activo
const loupeBox = computed(() => {
  const p = active.value
  if (!p) return '0 0 1 1'
  const half = LOUPE / 2 / (dispScale.value * ZOOM)
  return `${p.x - half} ${p.y - half} ${half * 2} ${half * 2}`
})
const loupeStroke = computed(() => 1.5 / (dispScale.value * ZOOM))

let start = null

function down(i, e) {
  e.target.setPointerCapture(e.pointerId)
  dispScale.value = svg.value.getBoundingClientRect().width / props.width
  start = { x: e.clientX, y: e.clientY, p: { ...props.modelValue[i] } }
  dragging.value = i
}

function move(e) {
  if (dragging.value < 0 || !start) return
  const k = dispScale.value
  const x = start.p.x + (e.clientX - start.x) / k
  const y = start.p.y + (e.clientY - start.y) / k
  const pts = props.modelValue.map((p) => ({ ...p }))
  pts[dragging.value] = { x: Math.min(props.width, Math.max(0, x)), y: Math.min(props.height, Math.max(0, y)) }
  emit('update:modelValue', pts)
}

function up() {
  dragging.value = -1
  start = null
}
</script>

<template>
  <div class="crop">
    <img :src="src" alt="" draggable="false" />
    <svg ref="svg" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" @pointermove="move" @pointerup="up" @pointercancel="up">
      <polygon :points="polygon" class="area" :style="{ strokeWidth: r / 3 }" />
      <g v-for="(p, i) in modelValue" :key="i">
        <circle :cx="p.x" :cy="p.y" :r="r" :class="['handle', { active: dragging === i }]" :style="{ strokeWidth: r / 3 }" />
        <!-- zona táctil más grande que el punto visible -->
        <circle :cx="p.x" :cy="p.y" :r="r * 3" class="hit" @pointerdown.prevent="down(i, $event)" />
      </g>
    </svg>

    <div v-if="active" class="loupe" :style="loupeStyle">
      <svg :viewBox="loupeBox" preserveAspectRatio="none">
        <image :href="src" x="0" y="0" :width="width" :height="height" preserveAspectRatio="none" />
        <polygon :points="polygon" class="loupe-edge" :style="{ strokeWidth: loupeStroke }" />
        <circle :cx="active.x" :cy="active.y" :r="loupeStroke * 5" class="loupe-dot" :style="{ strokeWidth: loupeStroke }" />
      </svg>
      <span class="cross h" /><span class="cross v" />
    </div>
  </div>
</template>

<style scoped>
.crop { position: relative; display: inline-block; max-width: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
img { display: block; max-width: 100%; max-height: 65vh; }
.crop > svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.area { fill: rgba(18, 163, 127, .18); stroke: var(--accent); }
.handle { fill: #fff; stroke: var(--accent); pointer-events: none; }
.handle.active { fill: var(--accent); }
.hit { fill: transparent; cursor: grab; }
.loupe {
  position: absolute; border-radius: 50%; overflow: hidden; border: 3px solid #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, .45); background: #000; pointer-events: none; z-index: 2;
}
.loupe svg { width: 100%; height: 100%; display: block; }
.loupe-edge { fill: none; stroke: var(--accent); }
.loupe-dot { fill: none; stroke: #fff; }
.cross { position: absolute; background: rgba(255, 255, 255, .9); box-shadow: 0 0 2px rgba(0, 0, 0, .8); }
.cross.h { left: 50%; top: 50%; width: 22px; height: 1.5px; transform: translate(-50%, -50%); }
.cross.v { left: 50%; top: 50%; width: 1.5px; height: 22px; transform: translate(-50%, -50%); }
</style>
