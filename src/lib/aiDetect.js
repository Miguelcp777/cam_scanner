// Detección de esquinas con IA: modelo DocAligner (DocsaidLab, Apache-2.0) de regresión de mapas de
// calor, ejecutado en el dispositivo con ONNX Runtime Web (WebAssembly, sin enviar nada a ningún servidor).
//  - Entrada: imagen RGB redimensionada a 256×256, valores 0..1, formato [1, 3, 256, 256].
//  - Salida: 4 mapas de calor (uno por esquina). Para cada uno se umbraliza al 0,3, se toma la mancha
//    más grande y su centroide (ponderado por el calor) es la esquina; se escala al tamaño original.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

// Se probó también FastViT-T8 (13 MB): menos confianza en las pruebas y casi 3 veces más pesado.
export const AI_MODELS = {
  lcnet100: { file: 'models/lcnet100_h_e_bifpn_256_fp32.onnx', label: 'LCNet100 (4,8 MB)' },
  // Aplanado de papel curvado: UVDoc (Verhoeven et al., 2023, MIT). Pesos en media precisión, cálculo en
  // float32 (nodos Cast): 15 MB en vez de 31 MB con diferencias < 0,001.
  uvdoc: { file: 'models/uvdoc_w16.onnx', label: 'UVDoc (15 MB)' },
}
export const DEFAULT_AI_MODEL = 'lcnet100'

const SIZE = 256
const THRESHOLD = 0.3
const sessions = {}
let ortPromise = null

function loadOrt() {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web/wasm').then((ort) => {
      ort.env.wasm.wasmPaths = { wasm: wasmUrl }
      ort.env.wasm.numThreads = 1 // sin cabeceras COOP/COEP no hay hilos; evita avisos y fallos en iOS
      return { ort }
    })
  }
  return ortPromise
}

export function loadAiModel(name = DEFAULT_AI_MODEL) {
  if (!sessions[name]) {
    sessions[name] = loadOrt().then(async ({ ort }) => {
      const url = import.meta.env.BASE_URL + AI_MODELS[name].file // ruta desde la raíz de la app, no de la página actual
      const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      return { ort, session }
    })
    sessions[name].catch(() => delete sessions[name]) // permitir reintentar si falla la descarga
  }
  return sessions[name]
}

const sizeOf = (src) => ({ w: src.naturalWidth || src.videoWidth || src.width, h: src.naturalHeight || src.videoHeight || src.height })

// Reutiliza un canvas de 256×256 para preparar la entrada
let inputCanvas = null
function toTensorData(src) {
  if (!inputCanvas) {
    inputCanvas = document.createElement('canvas')
    inputCanvas.width = inputCanvas.height = SIZE
  }
  const ctx = inputCanvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0, SIZE, SIZE)
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data
  const n = SIZE * SIZE
  const data = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    data[i] = px[i * 4] / 255
    data[n + i] = px[i * 4 + 1] / 255
    data[2 * n + i] = px[i * 4 + 2] / 255
  }
  return data
}

// Mancha más grande por encima del umbral (vecindad 4) y su centroide ponderado
function peak(plane, w, h) {
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let best = null
  let max = 0
  for (let i = 0; i < plane.length; i++) if (plane[i] > max) max = plane[i]
  for (let s = 0; s < plane.length; s++) {
    if (seen[s] || plane[s] < THRESHOLD) continue
    let top = 0, area = 0, sw = 0, sx = 0, sy = 0
    stack[top++] = s
    seen[s] = 1
    while (top) {
      const i = stack[--top]
      const x = i % w, y = (i / w) | 0, v = plane[i]
      area++
      sw += v
      sx += v * x
      sy += v * y
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && plane[j] >= THRESHOLD) {
          seen[j] = 1
          stack[top++] = j
        }
      }
    }
    if (!best || area > best.area) best = { area, x: sx / sw, y: sy / sw }
  }
  return best ? { ...best, max } : null
}

// Devuelve { points: [4 esquinas en coordenadas de `src`], confidence } o null si falta alguna esquina
export async function aiCorners(src, { model = DEFAULT_AI_MODEL } = {}) {
  const { ort, session } = await loadAiModel(model)
  const { w: W, h: H } = sizeOf(src)
  const input = new ort.Tensor('float32', toTensorData(src), [1, 3, SIZE, SIZE])
  const out = await session.run({ [session.inputNames[0]]: input })
  const hm = out[session.outputNames[0]]
  const [, c, hh, ww] = hm.dims
  const points = []
  let confidence = 1
  for (let k = 0; k < Math.min(4, c); k++) {
    const p = peak(hm.data.subarray(k * hh * ww, (k + 1) * hh * ww), ww, hh)
    if (!p) return null
    // Centro del píxel del mapa → coordenadas de la imagen original
    points.push({ x: ((p.x + 0.5) * W) / ww, y: ((p.y + 0.5) * H) / hh })
    confidence = Math.min(confidence, p.max)
  }
  return points.length === 4 ? { points, confidence } : null
}

// --- Aplanado con IA (UVDoc) ---------------------------------------------------------------------
// Entrada: imagen RGB 488×712 (ancho×alto), valores 0..1, [1, 3, 712, 488].
// Salida: malla [1, 2, 45, 31]: para cada punto de la página aplanada (31 columnas × 45 filas), la
// posición (x, y) en la imagen de entrada en coordenadas normalizadas −1..1 (esquinas incluidas).
const DEWARP_W = 488
const DEWARP_H = 712

// Devuelve { gx, gy, cols: 31, rows: 45 } con las posiciones en píxeles de `src`
export async function aiDewarpGrid(src) {
  const { ort, session } = await loadAiModel('uvdoc')
  const { w: W, h: H } = sizeOf(src)
  const c = document.createElement('canvas')
  c.width = DEWARP_W
  c.height = DEWARP_H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, DEWARP_W, DEWARP_H)
  const px = ctx.getImageData(0, 0, DEWARP_W, DEWARP_H).data
  c.width = c.height = 0
  const n = DEWARP_W * DEWARP_H
  const data = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    data[i] = px[i * 4] / 255
    data[n + i] = px[i * 4 + 1] / 255
    data[2 * n + i] = px[i * 4 + 2] / 255
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, DEWARP_H, DEWARP_W]) })
  const g = out[session.outputNames[0]]
  const [, , rows, cols] = g.dims
  const m = rows * cols
  const gx = new Float32Array(m), gy = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    gx[i] = ((g.data[i] + 1) / 2) * (W - 1)
    gy[i] = ((g.data[m + i] + 1) / 2) * (H - 1)
  }
  return { gx, gy, cols, rows }
}
