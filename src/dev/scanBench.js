// Banco de pruebas de detección de bordes (solo desarrollo; la app no lo importa).
// Uso, desde la consola del navegador con `npm run dev`:
//   const b = await import('/src/dev/scanBench.js'); console.table(await b.runBench())
// Genera fotos sintéticas con proyección 3D real de una hoja (esquinas conocidas) y mide el error.
import { detectCorners, flattenDocument, loadCV, measureLineCurvature, releaseCanvas, warpDocument, warpImage } from '../lib/scan'

function docCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')
  x.fillStyle = '#f7f5ef'
  x.fillRect(0, 0, w, h)
  x.fillStyle = '#222'
  x.font = `bold ${w / 18}px serif`
  x.fillText('FACTURA 2026-001', w * 0.1, h * 0.1)
  x.font = `${w / 34}px serif`
  for (let i = 0; i < 26; i++) x.fillText(`Linea de texto de ejemplo numero ${i + 1} con importe 1.250,00`, w * 0.1, h * 0.17 + i * h * 0.028)
  return c
}

// Curva la hoja: desplazamiento vertical bend·alto·sin(π·x/ancho) (como un tique que se enrolla)
function bendCanvas(cv, src, bend) {
  const w = src.width
  const h = src.height
  const A = Math.round(h * bend)
  const s = cv.imread(src)
  const out = new cv.Mat()
  const mx = new cv.Mat(h + 2 * A, w, cv.CV_32FC1)
  const my = new cv.Mat(h + 2 * A, w, cv.CV_32FC1)
  for (let y = 0; y < h + 2 * A; y++) {
    for (let x = 0; x < w; x++) {
      mx.data32F[y * w + x] = x
      my.data32F[y * w + x] = y - A - A * Math.sin((Math.PI * x) / w) + A
    }
  }
  cv.remap(s, out, mx, my, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0))
  const c = document.createElement('canvas')
  cv.imshow(c, out)
  ;[s, out, mx, my].forEach((m) => m.delete())
  return c
}

export async function photo({ ratio = 1 / Math.SQRT2, tiltX = 0.5, tiltY = 0.15, rotZ = 0.1, f = 1500, W = 1512, H = 2016, bg = '#5a4a3c', shadow = 0.5, finger = false, bend = 0 } = {}) {
  const { cv } = await loadCV()
  const dh = 0.297
  const dw = dh * ratio
  const D = 0.42
  const truth = [[-dw / 2, -dh / 2], [dw / 2, -dh / 2], [dw / 2, dh / 2], [-dw / 2, dh / 2]].map(([x, y]) => {
    let X = x * Math.cos(rotZ) - y * Math.sin(rotZ)
    let Y = x * Math.sin(rotZ) + y * Math.cos(rotZ)
    let Z = 0
    ;[Y, Z] = [Y * Math.cos(tiltX) - Z * Math.sin(tiltX), Y * Math.sin(tiltX) + Z * Math.cos(tiltX)]
    ;[X, Z] = [X * Math.cos(tiltY) + Z * Math.sin(tiltY), -X * Math.sin(tiltY) + Z * Math.cos(tiltY)]
    return { x: W / 2 + (f * X) / (Z + D), y: H / 2 + (f * Y) / (Z + D) }
  })
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ox = out.getContext('2d')
  ox.fillStyle = bg
  ox.fillRect(0, 0, W, H)
  const flat = docCanvas(1000, Math.round(1000 / ratio))
  const dc = bend ? bendCanvas(cv, flat, bend) : flat
  const s = cv.imread(dc)
  const d = cv.imread(out)
  const warped = new cv.Mat()
  const mask = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dc.width, 0, dc.width, dc.height, 0, dc.height])
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, truth.flatMap((p) => [p.x, p.y]))
  const M = cv.getPerspectiveTransform(from, to)
  // Máscara = canal alfa (la hoja curvada no ocupa todo su rectángulo)
  const planes = new cv.MatVector()
  cv.split(s, planes)
  const alpha = planes.get(3)
  cv.warpPerspective(s, warped, M, new cv.Size(W, H))
  cv.warpPerspective(alpha, mask, M, new cv.Size(W, H))
  cv.threshold(mask, mask, 128, 255, cv.THRESH_BINARY)
  warped.copyTo(d, mask)
  cv.imshow(out, d)
  ;[s, d, warped, mask, M, alpha, planes, from, to].forEach((m) => m.delete())
  if (shadow) {
    const g = ox.createLinearGradient(0, 0, W * 0.8, H)
    g.addColorStop(0, `rgba(0,0,0,${shadow})`)
    g.addColorStop(0.6, 'rgba(0,0,0,0.05)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ox.fillStyle = g
    ox.fillRect(0, 0, W, H)
  }
  if (finger) {
    ox.fillStyle = '#d6a07e'
    ox.beginPath()
    ox.ellipse(truth[3].x + 10, truth[3].y + 40, 70, 150, 0.5, 0, 7)
    ox.fill()
  }
  return { canvas: out, truth, ratio }
}

export const CASES = {
  'A4 inclinada 30°': {},
  'A4 muy inclinada 45° + giro': { tiltX: 0.8, tiltY: 0.25, rotZ: -0.3 },
  'Carta casi frontal': { ratio: 8.5 / 11, tiltX: 0.1, tiltY: 0.05, shadow: 0.3 },
  'A4 con dedo en esquina': { finger: true },
  'Fondo claro con sombra': { bg: '#cfccc4', tiltX: 0.4 },
  'Fondo claro sin sombra': { bg: '#d8d6d0', tiltX: 0.3, shadow: 0 },
  'Fondo oscuro, girada 35°': { bg: '#222', rotZ: 0.6, tiltX: 0.3 },
  'Tique estrecho sobre madera': { ratio: 0.33, bg: '#b5743a', tiltX: 0.35, rotZ: 0.06, shadow: 0.2 },
}

// Segunda pasada: parte de esquinas erróneas (sobra fondo en un lado y giradas) y mide el error final.
export async function runWarpBench() {
  const rows = []
  const cfgs = {
    'Tique estrecho sobre madera, sobra margen derecho': { ratio: 0.33, bg: '#b5743a', tiltX: 0.35, rotZ: 0.06, shadow: 0.2, bad: { right: 0.06, rot: 0.04 } },
    'A4 con recorte girado 3°': { tiltX: 0.4, bad: { right: 0.02, rot: 0.05 } },
  }
  for (const [name, { bad, ...cfg }] of Object.entries(cfgs)) {
    const { canvas, truth } = await photo(cfg)
    const cx = truth.reduce((s, p) => s + p.x, 0) / 4
    const cy = truth.reduce((s, p) => s + p.y, 0) / 4
    const wrong = truth.map((p, i) => {
      const extra = i === 1 || i === 2 ? bad.right * canvas.width : 0
      const x = p.x - cx + extra, y = p.y - cy
      return { x: cx + x * Math.cos(bad.rot) - y * Math.sin(bad.rot), y: cy + x * Math.sin(bad.rot) + y * Math.cos(bad.rot) }
    })
    const err = (pts) => Math.max(...truth.map((t, i) => Math.hypot(pts[i].x - t.x, pts[i].y - t.y)))
    const r = await warpDocument(canvas, wrong)
    rows.push({ caso: name, error_inicial_px: +err(wrong).toFixed(1), error_final_px: +err(r.points).toFixed(1), ok: err(r.points) < 10 ? '✓' : '✗' })
    releaseCanvas(r.canvas)
    releaseCanvas(canvas)
  }
  return rows
}

// Papel curvado: curvatura de los renglones (px, percentil 80) sin y con aplanado.
export async function runFlattenBench() {
  const { cv } = await loadCV()
  const cfgs = {
    'A4 curvada (3 %)': { bend: 0.03, tiltX: 0.3 },
    'A4 muy curvada (6 %)': { bend: 0.06, tiltX: 0.35, rotZ: -0.05 },
    'Tique enrollado (4 %) sobre madera': { ratio: 0.33, bend: 0.04 * 3, bg: '#b5743a', tiltX: 0.3, rotZ: 0.05, shadow: 0.2 },
    'A4 plana (control)': { tiltX: 0.4 },
  }
  const rows = []
  for (const [name, cfg] of Object.entries(cfgs)) {
    const { canvas } = await photo(cfg)
    const pts = await detectCorners(canvas)
    if (!pts) {
      rows.push({ caso: name, ok: '✗', nota: 'no detectado' })
      continue
    }
    const { canvas: plain, points } = await warpDocument(canvas, pts)
    const t0 = performance.now()
    const fl = await flattenDocument(canvas, points)
    const ms = Math.round(performance.now() - t0)
    const curv = (c) => {
      const m = cv.imread(c)
      const r = measureLineCurvature(cv, m)
      m.delete()
      return r
    }
    const before = curv(plain)
    const after = fl ? curv(fl.canvas) : before
    rows.push({
      caso: name,
      ok: after.max <= Math.max(3, before.max * 0.35) ? '✓' : '✗',
      curvatura_antes_px: +before.max.toFixed(1),
      curvatura_despues_px: +after.max.toFixed(1),
      renglones: before.lines,
      aplicado: fl ? [fl.edges && 'bordes', fl.lines && 'renglones'].filter(Boolean).join('+') : 'no',
      ms,
    })
    ;[plain, canvas, fl?.canvas].forEach(releaseCanvas)
  }
  return rows
}

export async function runBench(cases = CASES) {
  const rows = []
  for (const [name, cfg] of Object.entries(cases)) {
    const { canvas, truth, ratio } = await photo(cfg)
    const diag = Math.hypot(canvas.width, canvas.height)
    const t0 = performance.now()
    const pts = await detectCorners(canvas)
    const ms = Math.round(performance.now() - t0)
    if (!pts) {
      rows.push({ caso: name, ok: '✗', error_px: null, proporcion: null, real: ratio.toFixed(3), ms })
      continue
    }
    const err = Math.max(...truth.map((t) => Math.min(...pts.map((p) => Math.hypot(p.x - t.x, p.y - t.y)))))
    const w = await warpImage(canvas, pts)
    rows.push({
      caso: name,
      ok: err / diag < 0.004 ? '✓' : '✗',
      error_px: +err.toFixed(1),
      error_pct: +((err / diag) * 100).toFixed(2),
      proporcion: +(w.width / w.height).toFixed(3),
      real: +ratio.toFixed(3),
      ms,
    })
    releaseCanvas(w)
    releaseCanvas(canvas)
  }
  return rows
}
