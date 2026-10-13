// Procesado de imagen con OpenCV.js: detección de bordes, corrección de perspectiva y filtros.

let cvPromise = null

// OpenCV se carga bajo demanda (~10 MB). Ver opencv-loader.js: nunca devolver `cv` sin envolver.
export function loadCV() {
  if (!cvPromise) cvPromise = import('./opencv-loader.js').then((m) => m.ready())
  return cvPromise
}

export async function loadImage(blob) {
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  await img.decode()
  return img
}

// Safari/iOS limita la memoria total de canvas: liberar en cuanto no se necesiten.
export function releaseCanvas(c) {
  if (c) c.width = c.height = 0
}

// Foto → canvas reducido a maxSide (una foto de iPhone de 12 MP ocupa ~48 MB en memoria).
export async function prepareImage(blob, maxSide = 3000) {
  const img = await loadImage(blob)
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k)
  c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(img.src)
  return c
}

const sizeOf = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height })

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function fullCorners(w, h) {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

// Orden: superior-izquierda, superior-derecha, inferior-derecha, inferior-izquierda.
// Se ordena por ángulo alrededor del centro (robusto con documentos girados ~45°).
function orderPoints(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  sorted.forEach((p, i) => p.x + p.y < sorted[start].x + sorted[start].y && (start = i))
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4])
}

function polygonArea(q) {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i]
    const n = q[(i + 1) % 4]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

// Ángulos interiores razonables (la perspectiva los deforma, pero no tanto)
function plausibleQuad(q) {
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4]
    const b = q[i]
    const c = q[(i + 1) % 4]
    const v1 = { x: a.x - b.x, y: a.y - b.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    if (deg < 40 || deg > 140) return false
  }
  return true
}

// Envolvente convexa + aproximación con tolerancia creciente hasta obtener 4 vértices
// (tolera esquinas redondeadas, dobladas o tapadas por un dedo).
function quadFromContour(cv, cnt) {
  const hull = new cv.Mat()
  cv.convexHull(cnt, hull, false, true)
  const peri = cv.arcLength(hull, true)
  let quad = null
  for (let eps = 0.015; eps <= 0.1 && !quad; eps += 0.01) {
    const approx = new cv.Mat()
    cv.approxPolyDP(hull, approx, eps * peri, true)
    const n = approx.rows
    if (n === 4) quad = [0, 1, 2, 3].map((k) => ({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] }))
    approx.delete()
    if (n < 4) break
  }
  hull.delete()
  return quad
}

function medianOf(data) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i++) hist[data[i]]++
  let acc = 0
  for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= data.length / 2) return v
  return 127
}

// Busca el mejor cuadrilátero en un canvas pequeño (~500 px). Devuelve puntos en coordenadas del canvas o null.
export function findQuad(cv, canvas) {
  const W = canvas.width
  const H = canvas.height
  const imgArea = W * H
  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  const closed = new cv.Mat()
  const edges = new cv.Mat()
  const bin = new cv.Mat()
  const k3 = cv.Mat.ones(3, 3, cv.CV_8U)
  const k9 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9))
  let best = null
  let bestScore = 0
  const support = new cv.Mat()

  // Fracción del perímetro del candidato que cae sobre bordes reales de la imagen
  const edgeSupport = (q) => {
    let hit = 0
    let total = 0
    for (let i = 0; i < 4; i++) {
      const a = q[i]
      const b = q[(i + 1) % 4]
      const n = Math.max(8, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3))
      for (let s = 1; s < n; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / n)
        const y = Math.round(a.y + ((b.y - a.y) * s) / n)
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue // el borde de la foto no cuenta
        total++
        if (support.ucharAt(y, x)) hit++
      }
    }
    return total ? hit / total : 0
  }

  const consider = (map, mode) => {
    const contours = new cv.MatVector()
    const hier = new cv.Mat()
    cv.findContours(map, contours, hier, mode, cv.CHAIN_APPROX_SIMPLE)
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const rough = cv.contourArea(cnt)
      if (rough > imgArea * 0.03) {
        let q = quadFromContour(cv, cnt)
        // Último recurso: rectángulo girado mínimo que envuelve el contorno
        if (!q && rough > imgArea * 0.2) {
          const pts = cv.RotatedRect.points(cv.minAreaRect(cnt))
          q = pts.map((p) => ({ x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) }))
        }
        if (q) {
          q = orderPoints(q)
          const f = polygonArea(q) / imgArea
          // Desde un 4 % de la foto: los tiques largos y estrechos ocupan poca superficie
          if (f > 0.04 && f < 0.98 && plausibleQuad(q)) {
            const sup = edgeSupport(q)
            const score = Math.sqrt(f) * sup * sup // prioriza contornos bien apoyados en bordes reales
            if (sup > 0.45 && score > bestScore) {
              best = q
              bestScore = score
            }
          }
        }
      }
      cnt.delete()
    }
    contours.delete()
    hier.delete()
  }

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    // Cierre morfológico: borra el texto (oscuro y fino) para que el papel sea una mancha uniforme
    cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, k9, new cv.Point(-1, -1), 2)

    // Mapa de bordes permisivo (umbrales bajos) solo para puntuar candidatos
    cv.Canny(closed, support, 15, 45)
    cv.dilate(support, support, k3, new cv.Point(-1, -1), 2)

    // 1) Canny con umbrales automáticos según la mediana (se adapta al contraste de la escena)
    const med = medianOf(closed.data)
    cv.Canny(closed, edges, Math.max(10, 0.5 * med), Math.min(255, 1.2 * med))
    cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 2)
    consider(edges, cv.RETR_LIST)

    // 2) Canny clásico sobre la imagen sin cerrar (bordes finos, fondos con textura)
    cv.Canny(gray, edges, 30, 120)
    cv.dilate(edges, edges, k3)
    consider(edges, cv.RETR_LIST)

    // 3) Otsu: papel claro sobre fondo más oscuro (o al revés)
    cv.threshold(closed, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    consider(bin, cv.RETR_EXTERNAL)
    cv.bitwise_not(bin, bin)
    consider(bin, cv.RETR_EXTERNAL)
  } finally {
    ;[src, gray, closed, edges, bin, k3, k9, support].forEach((m) => m.delete())
  }
  return best
}

const DETECT_SIDE = 500
const REFINE_SIDE = 1400

function scaledCanvas(img, maxSide) {
  const { w: W, h: H } = sizeOf(img)
  const scale = Math.min(1, maxSide / Math.max(W, H))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(W * scale)
  canvas.height = Math.round(H * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return { canvas, scale }
}

// Recta robusta: RANSAC (ignora grupos de píxeles ajenos al borde, p. ej. un dedo) + ajuste PCA de los inliers.
function fitLine(pts) {
  let seed = 12345
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  // Muestra de como mucho 600 puntos para puntuar hipótesis; los inliers finales se toman de todos
  const step = Math.max(1, Math.floor(pts.length / 600))
  const sample = step > 1 ? pts.filter((_, i) => i % step === 0) : pts
  const inliers = (set, a, nx, ny) => set.filter((p) => Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny) < 2)
  let best = null
  let bestCount = 0
  for (let it = 0; it < 120; it++) {
    const a = sample[Math.floor(rnd() * sample.length)]
    const b = sample[Math.floor(rnd() * sample.length)]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len < 20) continue
    const n = inliers(sample, a, -dy / len, dx / len).length
    if (n > bestCount) {
      bestCount = n
      best = { a, nx: -dy / len, ny: dx / len }
    }
  }
  const inl = best ? inliers(pts, best.a, best.nx, best.ny) : pts
  return fitPca(inl.length >= 20 ? inl : pts)
}

function fitPca(pts) {
  const fit = (ps) => {
    let mx = 0, my = 0
    for (const p of ps) { mx += p[0]; my += p[1] }
    mx /= ps.length; my /= ps.length
    let sxx = 0, syy = 0, sxy = 0
    for (const p of ps) {
      const dx = p[0] - mx, dy = p[1] - my
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy
    }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    return { x: mx, y: my, ux: Math.cos(a), uy: Math.sin(a) }
  }
  let l = fit(pts)
  const d = pts.map((p) => Math.abs((p[0] - l.x) * -l.uy + (p[1] - l.y) * l.ux))
  const med = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)]
  const keep = pts.filter((_, i) => d[i] <= Math.max(1.5, 2.5 * med))
  if (keep.length >= 20) l = fit(keep)
  return l
}

function intersect(l1, l2) {
  const den = l1.ux * l2.uy - l1.uy * l2.ux
  if (Math.abs(den) < 1e-6) return null
  const t = ((l2.x - l1.x) * l2.uy - (l2.y - l1.y) * l2.ux) / den
  return { x: l1.x + t * l1.ux, y: l1.y + t * l1.uy }
}

// Afinado: a mayor resolución, ajusta una recta a los píxeles de borde cercanos a cada lado
// y toma las esquinas como intersección de rectas (exacto aunque la esquina esté doblada o tapada).
// Dos pasadas: banda ancha para corregir la estimación gruesa y banda estrecha para precisión.
// passes: [banda, desplazamiento máximo] como fracción de la diagonal, de más ancha a más estrecha
const PASSES_DEFAULT = [
  [0.035, 0.09],
  [0.012, 0.03],
]
const PASSES_WIDE = [[0.07, 0.15], ...PASSES_DEFAULT]

export function refineQuad(cv, canvas, quad, passes = PASSES_DEFAULT) {
  const W = canvas.width
  const H = canvas.height
  const diag = Math.hypot(W, H)
  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  const edges = new cv.Mat()
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(11, 11))
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, k)
    const med = medianOf(gray.data)
    cv.Canny(gray, edges, Math.max(10, 0.5 * med), Math.min(255, 1.2 * med))
    const map = { data: edges.data, W, H }
    return passes.reduce((q, [band, move]) => refinePass(map, q, diag * band, diag * move), quad)
  } finally {
    ;[src, gray, edges, k].forEach((m) => m.delete())
  }
}

// Recorre solo la franja de ±band alrededor de cada lado (no toda la imagen).
function refinePass({ data, W, H }, quad, band, maxMove) {
  const lines = quad.map((a, i) => {
    const b = quad[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
    const nx = -uy, ny = ux
    const pts = []
    const seen = new Set()
    for (let s = len * 0.06; s < len * 0.94; s += 1) {
      const bx = a.x + ux * s, by = a.y + uy * s
      for (let d = -band; d <= band; d += 1) {
        const x = Math.round(bx + nx * d), y = Math.round(by + ny * d)
        if (x < 0 || y < 0 || x >= W || y >= H) continue
        const j = y * W + x
        if (data[j] && !seen.has(j)) {
          seen.add(j)
          pts.push([x, y])
        }
      }
    }
    return pts.length >= 30 ? fitLine(pts) : null
  })
  return quad.map((orig, i) => {
    const l1 = lines[(i + 3) % 4]
    const l2 = lines[i]
    const p = l1 && l2 ? intersect(l1, l2) : null
    // Si el afinado se va demasiado lejos, se conserva la esquina original
    return p && Math.hypot(p.x - orig.x, p.y - orig.y) < maxMove ? p : orig
  })
}

// Detección sobre una imagen o canvas de cualquier tamaño. Devuelve 4 puntos o null si no hay documento claro.
export async function detectCorners(img) {
  const { cv } = await loadCV()
  const coarse = scaledCanvas(img, DETECT_SIDE)
  let quad
  try {
    quad = findQuad(cv, coarse.canvas)
  } finally {
    releaseCanvas(coarse.canvas)
  }
  if (!quad) return null
  const fine = scaledCanvas(img, REFINE_SIDE)
  try {
    const k = fine.scale / coarse.scale
    const refined = refineQuad(cv, fine.canvas, quad.map((p) => ({ x: p.x * k, y: p.y * k })))
    return orderPoints(refined.map((p) => ({ x: p.x / fine.scale, y: p.y / fine.scale })))
  } catch (e) {
    console.warn('Afinado de bordes fallido', e)
    return quad.map((p) => ({ x: p.x / coarse.scale, y: p.y / coarse.scale }))
  } finally {
    releaseCanvas(fine.canvas)
  }
}

// Detección continua sobre el vídeo de la cámara (reutiliza un canvas pequeño).
export function createLiveDetector(cv) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return {
    detect(video) {
      const W = video.videoWidth
      const H = video.videoHeight
      if (!W || !H) return null
      const scale = Math.min(1, 360 / Math.max(W, H))
      canvas.width = Math.round(W * scale)
      canvas.height = Math.round(H * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const q = findQuad(cv, canvas)
      return q ? q.map((p) => ({ x: p.x / scale, y: p.y / scale })) : null
    },
    release: () => releaseCanvas(canvas),
  }
}

const MAX_SIDE = 2480 // ~A4 a 300 ppp

// Proporción real ancho/alto de un rectángulo visto en perspectiva, estimando la focal de la cámara
// (Zhang & He, "Whiteboard scanning and image enhancement"). Si no es fiable, media de los lados.
function trueAspect(pts, W, H) {
  const [tl, tr, br, bl] = pts
  const naive = (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br))
  const u0 = W / 2
  const v0 = H / 2
  const m1 = [tl.x, tl.y, 1], m2 = [tr.x, tr.y, 1], m3 = [bl.x, bl.y, 1], m4 = [br.x, br.y, 1]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3)
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2)
  const n2 = m2.map((v, i) => k2 * v - m1[i])
  const n3 = m3.map((v, i) => k3 * v - m1[i])
  const f2 =
    -(
      n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0 +
      (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)
    ) / (n2[2] * n3[2])
  const side = Math.max(W, H)
  if (!(f2 > 0) || !isFinite(f2) || Math.sqrt(f2) < 0.3 * side || Math.sqrt(f2) > 6 * side) return naive
  const f = Math.sqrt(f2)
  const q = (n) => ((n[0] - u0 * n[2]) / f) ** 2 + ((n[1] - v0 * n[2]) / f) ** 2 + n[2] ** 2
  const r = Math.sqrt(q(n2) / q(n3))
  return isFinite(r) && r > 0 && Math.abs(Math.log(r / naive)) < 0.4 ? r : naive
}

// Ajusta a A4 o Carta si la proporción está a menos de un 4 %
function snapAspect(r) {
  for (const p of [1 / Math.SQRT2, 8.5 / 11]) {
    for (const t of [p, 1 / p]) if (Math.abs(r / t - 1) < 0.04) return t
  }
  return r
}

// Tamaño del documento enderezado (proporción real, lado mayor ≤ MAX_SIDE)
function targetSize(img, pts) {
  const [tl, tr, br, bl] = pts
  const { w: W, h: H } = sizeOf(img)
  const ratio = snapAspect(trueAspect(pts, W, H))
  let h = Math.max(dist(tl, bl), dist(tr, br))
  let w = h * ratio
  const k = Math.min(1, MAX_SIDE / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

// Endereza el cuadrilátero a un rectángulo w×h, con un margen `pad` alrededor (Mat RGBA).
function warpToMat(cv, img, pts, w, h, pad = 0) {
  const [tl, tr, br, bl] = pts
  const src = cv.imread(img)
  const dst = new cv.Mat()
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [pad, pad, pad + w, pad, pad + w, pad + h, pad, pad + h])
  const M = cv.getPerspectiveTransform(srcTri, dstTri)
  try {
    const border = pad ? cv.BORDER_CONSTANT : cv.BORDER_REPLICATE
    cv.warpPerspective(src, dst, M, new cv.Size(w + 2 * pad, h + 2 * pad), cv.INTER_LINEAR, border, new cv.Scalar(0, 0, 0, 255))
    return dst
  } catch (e) {
    dst.delete()
    throw e
  } finally {
    ;[src, srcTri, dstTri, M].forEach((m) => m.delete())
  }
}

export async function warpImage(img, pts) {
  const { cv } = await loadCV()
  const { w, h } = targetSize(img, pts)
  const dst = warpToMat(cv, img, pts, w, h)
  const out = document.createElement('canvas')
  try {
    cv.imshow(out, dst)
  } finally {
    dst.delete()
  }
  return out
}

// Ajusta unas esquinas aproximadas (detección en vivo, recorte impreciso) a los bordes reales del papel
// en la foto original: rectas robustas a lo largo de cada lado, con una primera banda ancha.
export async function snapToPaper(img, pts) {
  const { cv } = await loadCV()
  const fine = scaledCanvas(img, REFINE_SIDE)
  try {
    const s = fine.scale
    const q = refineQuad(cv, fine.canvas, pts.map((p) => ({ x: p.x * s, y: p.y * s })), PASSES_WIDE)
    const out = orderPoints(q.map((p) => ({ x: p.x / s, y: p.y / s })))
    return plausibleQuad(out) ? out : pts
  } finally {
    releaseCanvas(fine.canvas)
  }
}

// Recorte final con esquinas automáticas: se ajustan al papel exacto antes de enderezar.
export async function warpDocument(img, pts) {
  const points = await snapToPaper(img, pts)
  return { canvas: await warpImage(img, points), points }
}

// ---------------------------------------------------------------------------------------------
// Aplanado de papel curvado (tiques enrollados, hojas dobladas, páginas de libro)
//  1) Bordes: tras enderezar la perspectiva (con margen), cada borde del papel se ajusta a una curva
//     y una interpolación de Coons lleva esa región curva a un rectángulo.
//  2) Renglones: se detectan las líneas de texto, se ajusta su curvatura y se desplaza cada columna
//     en vertical para que vuelvan a ser horizontales (corrige la curvatura interior).
// ---------------------------------------------------------------------------------------------

function solve3(m, v) {
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const D = det(m)
  if (Math.abs(D) < 1e-12) return null
  return [0, 1, 2].map((k) => det(m.map((row, i) => row.map((x, j) => (j === k ? v[i] : x)))) / D)
}

// Parábola por mínimos cuadrados: y = c0 + c1·x + c2·x²
function polyfit2(xs, ys) {
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i], x2 = x * x
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2
    t0 += y; t1 += x * y; t2 += x2 * y
  }
  return solve3([[xs.length, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2])
}

const evalPoly = (c, x) => c[0] + c[1] * x + c[2] * x * x

// Ajuste con una pasada de rechazo de atípicos; devuelve { c, rms } o null
function robustFit(xs, ys, minPts = 6) {
  if (xs.length < minPts) return null
  let c = polyfit2(xs, ys)
  if (!c) return null
  const res = xs.map((x, i) => Math.abs(ys[i] - evalPoly(c, x)))
  const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)]
  const keep = res.map((r, i) => (r <= Math.max(1.5, 3 * med) ? i : -1)).filter((i) => i >= 0)
  if (keep.length < minPts) return null
  c = polyfit2(keep.map((i) => xs[i]), keep.map((i) => ys[i])) || c
  const rms = Math.sqrt(keep.reduce((s, i) => s + (ys[i] - evalPoly(c, xs[i])) ** 2, 0) / keep.length)
  return { c, rms }
}

// Curvas de los 4 bordes en la imagen enderezada con margen. Desplazamiento d(t) en px respecto al
// rectángulo nominal; t ∈ [0,1] a lo largo del lado. Supone papel más claro que el fondo.
function findEdgeCurves(cv, padded, pad, w, h) {
  const s = Math.min(1, 1200 / Math.max(padded.cols, padded.rows))
  const small = new cv.Mat()
  const gray = new cv.Mat()
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15))
  try {
    cv.resize(padded, small, new cv.Size(0, 0), s, s, cv.INTER_AREA)
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, k) // borra el texto
    const G = gray.data, GW = gray.cols, GH = gray.rows
    const at = (x, y) => G[Math.min(GH - 1, Math.max(0, y)) * GW + Math.min(GW - 1, Math.max(0, x))]
    const P = pad * s, Ws = w * s, Hs = h * s
    const band = Math.round(Math.max(Ws, Hs) * 0.05)
    const o = 3
    const scan = (side) => {
      const ts = [], ds = []
      const N = 60
      for (let i = 0; i <= N; i++) {
        const t = 0.04 + (0.92 * i) / N
        let best = 0, bestD = null
        for (let d = -band; d <= band; d++) {
          let g
          if (side === 'top') { const x = Math.round(P + t * Ws), y = Math.round(P + d); g = at(x, y + o) - at(x, y - o) }
          else if (side === 'bottom') { const x = Math.round(P + t * Ws), y = Math.round(P + Hs + d); g = at(x, y - o) - at(x, y + o) }
          else if (side === 'left') { const y = Math.round(P + t * Hs), x = Math.round(P + d); g = at(x + o, y) - at(x - o, y) }
          else { const y = Math.round(P + t * Hs), x = Math.round(P + Ws + d); g = at(x - o, y) - at(x + o, y) }
          if (g > best) { best = g; bestD = d }
        }
        if (best >= 12) { ts.push(t); ds.push(bestD / s) }
      }
      // Si apenas se ve el borde (o hay demasiado ruido), se asume recto
      const fit = ts.length >= N * 0.4 ? robustFit(ts, ds, 10) : null
      return fit && fit.rms < Math.max(w, h) * 0.006 ? fit.c : null
    }
    return { top: scan('top'), bottom: scan('bottom'), left: scan('left'), right: scan('right') }
  } finally {
    ;[small, gray, k].forEach((m) => m.delete())
  }
}

// Remapeo por franjas horizontales (evita mapas de decenas de MB en el móvil).
// fill(y, mx, my, w) rellena los mapas de origen para la fila de salida y.
function remapStrips(cv, src, w, h, fill) {
  const out = new cv.Mat(h, w, src.type())
  const STRIP = 256
  for (let y0 = 0; y0 < h; y0 += STRIP) {
    const sh = Math.min(STRIP, h - y0)
    const mapX = new cv.Mat(sh, w, cv.CV_32FC1)
    const mapY = new cv.Mat(sh, w, cv.CV_32FC1)
    const dst = new cv.Mat()
    try {
      const mx = mapX.data32F, my = mapY.data32F
      for (let r = 0; r < sh; r++) fill(y0 + r, mx.subarray(r * w, (r + 1) * w), my.subarray(r * w, (r + 1) * w), w)
      cv.remap(src, dst, mapX, mapY, cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar())
      const roi = out.roi(new cv.Rect(0, y0, w, sh))
      dst.copyTo(roi)
      roi.delete()
    } finally {
      ;[mapX, mapY, dst].forEach((m) => m.delete())
    }
  }
  return out
}

// Interpolación de Coons: región limitada por las 4 curvas → rectángulo w×h
function coonsRemap(cv, padded, pad, w, h, f) {
  const D = (c, t) => (c ? evalPoly(c, t) : 0)
  const TL = { x: pad + D(f.left, 0), y: pad + D(f.top, 0) }
  const TR = { x: pad + w + D(f.right, 0), y: pad + D(f.top, 1) }
  const BL = { x: pad + D(f.left, 1), y: pad + h + D(f.bottom, 0) }
  const BR = { x: pad + w + D(f.right, 1), y: pad + h + D(f.bottom, 1) }
  const Tx = new Float32Array(w), Ty = new Float32Array(w), Bx = new Float32Array(w), By = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const u = w > 1 ? x / (w - 1) : 0
    Tx[x] = TL.x + (TR.x - TL.x) * u; Ty[x] = pad + D(f.top, u)
    Bx[x] = BL.x + (BR.x - BL.x) * u; By[x] = pad + h + D(f.bottom, u)
  }
  return remapStrips(cv, padded, w, h, (y, mx, my) => {
    const v = h > 1 ? y / (h - 1) : 0
    const Lx = pad + D(f.left, v), Ly = TL.y + (BL.y - TL.y) * v
    const Rx = pad + w + D(f.right, v), Ry = TR.y + (BR.y - TR.y) * v
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0
      const cx = (1 - u) * (1 - v) * TL.x + u * (1 - v) * TR.x + (1 - u) * v * BL.x + u * v * BR.x
      const cy = (1 - u) * (1 - v) * TL.y + u * (1 - v) * TR.y + (1 - u) * v * BL.y + u * v * BR.y
      mx[x] = (1 - v) * Tx[x] + v * Bx[x] + (1 - u) * Lx + u * Rx - cx
      my[x] = (1 - v) * Ty[x] + v * By[x] + (1 - u) * Ly + u * Ry - cy
    }
  })
}

// Renglones de texto: cada uno con su parábola y(x) y su altura media y0 (coordenadas de `mat`).
function findTextLines(cv, mat) {
  const W = mat.cols, H = mat.rows
  const s = Math.min(1, 1400 / Math.max(W, H))
  const small = new cv.Mat()
  const bin = new cv.Mat()
  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const cents = new cv.Mat()
  try {
    cv.resize(mat, small, new cv.Size(0, 0), s, s, cv.INTER_AREA)
    cv.cvtColor(small, small, cv.COLOR_RGBA2GRAY)
    cv.adaptiveThreshold(small, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 25, 15)
    const Ws = bin.cols, Hs = bin.rows
    // Une las letras de cada renglón con un trazo horizontal
    const kx = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(9, Math.round(Ws * 0.025)), 1))
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kx)
    kx.delete()
    const n = cv.connectedComponentsWithStats(bin, labels, stats, cents, 8, cv.CV_32S)
    const st = stats.data32S, lab = labels.data32S
    const lines = []
    for (let i = 1; i < n; i++) {
      const bx = st[i * 5], by = st[i * 5 + 1], bw = st[i * 5 + 2], bh = st[i * 5 + 3]
      // Un renglón curvado ocupa mucha altura total, pero su trazo es fino en cada columna
      if (bw < Ws * 0.3 || bh > Hs * 0.25 || bh < 3) continue
      const xs = [], ys = []
      let thick = 0
      for (let x = bx; x < bx + bw; x += 3) {
        let sum = 0, cnt = 0
        for (let y = by; y < by + bh; y++) if (lab[y * Ws + x] === i) { sum += y; cnt++ }
        if (cnt) { xs.push(x / s); ys.push(sum / cnt / s); thick += cnt }
      }
      if (!xs.length || thick / xs.length > Math.max(4, Hs * 0.035)) continue // bloque de varias líneas, no un renglón
      const fit = robustFit(xs, ys, 8)
      if (!fit || fit.rms > Math.max(2, (thick / xs.length / s) * 0.6)) continue
      const x0 = bx / s, x1 = (bx + bw) / s
      let y0 = 0
      for (let k = 0; k <= 10; k++) y0 += evalPoly(fit.c, x0 + ((x1 - x0) * k) / 10)
      lines.push({ c: fit.c, y0: y0 / 11, x0, x1 })
    }
    return lines.sort((a, b) => a.y0 - b.y0)
  } finally {
    ;[small, bin, labels, stats, cents].forEach((m) => m.delete())
  }
}

// Desplazamiento vertical de cada renglón respecto a su altura media, por columna
function lineProfiles(lines, w) {
  return lines.map((l) => {
    const d = new Float32Array(w)
    for (let x = 0; x < w; x++) d[x] = evalPoly(l.c, Math.min(l.x1, Math.max(l.x0, x))) - l.y0
    return { y0: l.y0, d }
  })
}

const maxAbs = (arr) => arr.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

// Curvatura residual de los renglones en px (para medir y decidir si hace falta aplanar)
export function measureLineCurvature(cv, mat) {
  const lines = findTextLines(cv, mat)
  if (lines.length < 3) return { lines: lines.length, max: 0 }
  const prof = lineProfiles(lines, mat.cols).map((p) => maxAbs(p.d)).sort((a, b) => a - b)
  return { lines: lines.length, max: prof[Math.floor(prof.length * 0.8)] } // percentil 80: ignora renglones raros
}

function straightenLines(cv, mat) {
  const w = mat.cols, h = mat.rows
  const lines = findTextLines(cv, mat)
  if (lines.length < 3) return null
  const prof = lineProfiles(lines, w)
  if (Math.max(...prof.map((p) => maxAbs(p.d))) < h * 0.002) return null
  return remapStrips(cv, mat, w, h, (y, mx, my) => {
    let i = 0
    while (i < prof.length - 1 && prof[i + 1].y0 < y) i++
    const a = prof[i]
    const b = prof[Math.min(prof.length - 1, i + 1)]
    const t = b.y0 > a.y0 ? Math.min(1, Math.max(0, (y - a.y0) / (b.y0 - a.y0))) : 0
    for (let x = 0; x < w; x++) {
      mx[x] = x
      my[x] = y + (1 - t) * a.d[x] + t * b.d[x]
    }
  })
}

// Devuelve { canvas, edges, lines } o null si el papel no está curvado (usar el recorte normal).
export async function flattenDocument(img, pts) {
  const { cv } = await loadCV()
  const { w, h } = targetSize(img, pts)
  const pad = Math.round(Math.max(w, h) * 0.05)
  const padded = warpToMat(cv, img, pts, w, h, pad)
  let mat = null
  let edges = false
  let lines = false
  try {
    const curves = findEdgeCurves(cv, padded, pad, w, h)
    const dev = Math.max(
      ...['top', 'bottom', 'left', 'right'].map((k) =>
        curves[k] ? Math.max(...[0, 0.25, 0.5, 0.75, 1].map((t) => Math.abs(evalPoly(curves[k], t)))) : 0,
      ),
    )
    if (dev > Math.max(w, h) * 0.004) {
      mat = coonsRemap(cv, padded, pad, w, h, curves)
      edges = true
    } else {
      const roi = padded.roi(new cv.Rect(pad, pad, w, h))
      mat = roi.clone()
      roi.delete()
    }
    const straight = straightenLines(cv, mat)
    if (straight) {
      mat.delete()
      mat = straight
      lines = true
    }
    if (!edges && !lines) return null
    const canvas = document.createElement('canvas')
    cv.imshow(canvas, mat)
    return { canvas, edges, lines }
  } finally {
    padded.delete()
    mat?.delete()
  }
}

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'enhance', label: 'Documento' },
  { id: 'gray', label: 'Gris' },
  { id: 'bw', label: 'B/N' },
]

// Corrige la iluminación: estima el "fondo" del papel (sin texto) a baja resolución y divide la
// imagen por él → papel blanco uniforme, sin sombras ni viñeteado, conservando el color de la tinta.
function normalizeIllumination(cv, src) {
  const rgb = new cv.Mat()
  const small = new cv.Mat()
  const bg = new cv.Mat()
  const out = new cv.Mat()
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7))
  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    const s = Math.min(1, 600 / Math.max(rgb.cols, rgb.rows))
    cv.resize(rgb, small, new cv.Size(0, 0), s, s, cv.INTER_AREA)
    cv.dilate(small, small, k) // el máximo local borra el texto oscuro
    cv.medianBlur(small, small, 21)
    cv.resize(small, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR)
    cv.divide(rgb, bg, out, 255)
    return out
  } catch (e) {
    out.delete()
    throw e
  } finally {
    ;[rgb, small, bg, k].forEach((m) => m.delete())
  }
}

// Restos de mesa/fondo que quedan en los bordes al recortar papel curvado o con esquinas dobladas.
// Desde cada borde hacia dentro se busca, línea a línea, una franja oscura cercana al borde (empieza en
// el primer 5 % y acaba antes del 10 %). Solo se borra si continúa a lo largo de muchas líneas seguidas
// (≥ 4 % del lado) en una posición estable: así es un borde/resto de fondo y no una letra.
const DARK = 150
function whitenBorders(rgb, gray, orig) {
  const W = gray.cols
  const H = gray.rows
  const g = gray.data
  const c = rgb.data // RGB, 3 canales
  const o = orig.data // RGBA original: la saturación delata fondos de color (madera, mantel…)
  const isBg = (j) => {
    if (g[j] < DARK) return true
    const r = o[j * 4], gg = o[j * 4 + 1], b = o[j * 4 + 2]
    return Math.max(r, gg, b) - Math.min(r, gg, b) > 55
  }
  const paint = (j) => {
    g[j] = 255
    c[j * 3] = c[j * 3 + 1] = c[j * 3 + 2] = 255
  }
  // n: píxeles desde el borde hacia dentro; m: número de líneas; idx(i, k): píxel k de la línea i
  const side = (n, m, idx) => {
    const s0 = Math.ceil(n * 0.05)
    const lim = Math.ceil(n * 0.1)
    const starts = new Int32Array(m).fill(-1)
    const ends = new Int32Array(m).fill(-1)
    for (let i = 0; i < m; i++) {
      let k = 0
      while (k < s0 && !isBg(idx(i, k))) k++
      if (k >= s0) continue
      const st = k
      while (k < lim && isBg(idx(i, k))) k++
      if (k >= lim) continue // demasiado ancha: probablemente contenido
      starts[i] = st
      ends[i] = k
    }
    const minLen = Math.ceil(m * 0.04)
    const drift = Math.max(3, n * 0.004)
    const halo = Math.ceil(n * 0.006)
    for (let a = 0; a < m; ) {
      if (ends[a] < 0) {
        a++
        continue
      }
      let b = a
      while (b + 1 < m && ends[b + 1] >= 0 && Math.abs(starts[b + 1] - starts[b]) <= drift) b++
      if (b - a + 1 >= minLen) {
        for (let i = a; i <= b; i++) {
          const end = Math.min(lim, ends[i] + halo)
          for (let k = 0; k < end; k++) paint(idx(i, k))
        }
      }
      a = b + 1
    }
  }
  side(W, H, (i, k) => i * W + k) // izquierda
  side(W, H, (i, k) => i * W + W - 1 - k) // derecha
  side(H, W, (i, k) => k * W + i) // arriba
  side(H, W, (i, k) => (H - 1 - k) * W + i) // abajo
}

function percentile(gray, p) {
  const hist = new Uint32Array(256)
  const d = gray.data
  for (let i = 0; i < d.length; i += 3) hist[d[i]]++ // muestreo 1 de cada 3 píxeles
  const target = (d.length / 3) * p
  let acc = 0
  for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= target) return v
  return 255
}

// Niveles adaptativos: el tono real del papel (y arrugas/dobleces claros) → blanco puro; la tinta, más oscura.
function levels(img, gray) {
  const white = Math.max(190, Math.min(245, percentile(gray, 0.3) - 4))
  const black = Math.min(90, percentile(gray, 0.01))
  const alpha = 255 / Math.max(40, white - black)
  img.convertTo(img, -1, alpha, -black * alpha)
}

export async function applyFilter(canvas, filter) {
  const out = document.createElement('canvas')
  if (filter === 'original') {
    out.width = canvas.width
    out.height = canvas.height
    out.getContext('2d').drawImage(canvas, 0, 0)
    return out
  }
  const { cv } = await loadCV()
  const src = cv.imread(canvas)
  const norm = normalizeIllumination(cv, src)
  const gray = new cv.Mat()
  try {
    cv.cvtColor(norm, gray, cv.COLOR_RGB2GRAY)
    whitenBorders(norm, gray, src)
    if (filter === 'enhance') {
      levels(norm, gray)
      cv.imshow(out, norm)
    } else {
      levels(gray, gray)
      if (filter === 'bw') cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 14)
      cv.imshow(out, gray)
    }
  } finally {
    ;[src, norm, gray].forEach((m) => m.delete())
  }
  return out
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}
