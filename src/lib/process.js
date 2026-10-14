// Procesado de una página: foto → esquinas → recorte (+ajuste al papel, +aplanado) → filtro → giro.
// Lo usan el escáner (paso a paso), el modo ráfaga (automático) y la edición de páginas guardadas.
import { uid } from './db'
import {
  applyFilter,
  canvasToBlob,
  detectCorners,
  flattenDocument,
  fullCorners,
  prepareImage,
  releaseCanvas,
  rotateCanvas,
  warpDocument,
  warpImage,
} from './scan'

export const DEFAULT_FILTER = 'enhance'
export const DEFAULT_FLATTEN = true

// Foto → canvas de trabajo (≤3000 px) y su JPEG, que se guarda como "original" para poder reeditar.
// Si la foto ya es un original guardado, no se vuelve a comprimir (evita perder calidad en cada edición).
export async function loadSource(blob, { isOriginal = false } = {}) {
  const canvas = await prepareImage(blob)
  const original = isOriginal ? blob : await canvasToBlob(canvas, 'image/jpeg', 0.9)
  return { canvas, original }
}

// Esquinas automáticas; si la foto no deja ver el documento, las vistas en vivo; si no, la imagen entera
export async function findCorners(canvas, hint = null) {
  let pts = await detectCorners(canvas)
  if (!pts && hint) {
    const k = canvas.width / hint.w
    pts = hint.pts.map((p) => ({ x: p.x * k, y: p.y * k }))
  }
  return { points: pts || fullCorners(canvas.width, canvas.height), detected: !!pts }
}

// Recorte con corrección de perspectiva. snap: ajustar esquinas automáticas al borde exacto del papel.
export async function cropPage(canvas, points, { snap = false, flatten = DEFAULT_FLATTEN } = {}) {
  let pts = points
  let warped
  if (snap) {
    const r = await warpDocument(canvas, points)
    warped = r.canvas
    pts = r.points
  } else {
    warped = await warpImage(canvas, points)
  }
  let flattened = ''
  if (flatten) {
    const f = await flattenDocument(canvas, pts)
    if (f) {
      releaseCanvas(warped)
      warped = f.canvas
      flattened = f.ai ? 'con IA' : [f.edges && 'bordes', f.lines && 'renglones'].filter(Boolean).join(' y ')
    }
  }
  return { warped, points: pts, flattened }
}

// Filtro + giro → canvas final
export async function renderPage(warped, filter = DEFAULT_FILTER, rotation = 0) {
  const filtered = await applyFilter(warped, filter)
  const out = rotateCanvas(filtered, rotation)
  if (out !== filtered) releaseCanvas(filtered)
  return out
}

export async function canvasToPage(out) {
  return { blob: await canvasToBlob(out), width: out.width, height: out.height }
}

// Página completa sin intervención (modo ráfaga e importación de varias imágenes)
export async function autoPage(blob, hint = null, { filter = DEFAULT_FILTER, flatten = DEFAULT_FLATTEN } = {}) {
  const { canvas, original } = await loadSource(blob)
  try {
    const { points, detected } = await findCorners(canvas, hint)
    const { warped, points: pts } = await cropPage(canvas, points, { snap: detected, flatten })
    const out = await renderPage(warped, filter)
    releaseCanvas(warped)
    const page = {
      id: uid(),
      ...(await canvasToPage(out)),
      text: '',
      original,
      points: pts,
      filter,
      flatten,
      rotation: 0,
      detected,
    }
    releaseCanvas(out)
    return page
  } finally {
    releaseCanvas(canvas)
  }
}

// Carné / DNI: anverso y reverso (ya recortados) a tamaño real sobre un A4 a 300 ppp
export async function composeIdCard(sides) {
  const { loadImage } = await import('./scan')
  const W = 2480, H = 3508 // A4 a 300 ppp
  const cardW = Math.round((W * 85.6) / 210)
  const cardH = Math.round((cardW * 53.98) / 85.6)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')
  x.fillStyle = '#fff'
  x.fillRect(0, 0, W, H)
  const gap = 260
  let y = Math.round((H - (sides.length * cardH + (sides.length - 1) * gap)) / 3) // algo por encima del centro
  for (const blob of sides) {
    const img = await loadImage(blob)
    let src = img
    let tmp = null
    if (img.naturalHeight > img.naturalWidth) {
      // Tarjeta fotografiada en vertical: se pone apaisada
      tmp = document.createElement('canvas')
      tmp.width = img.naturalWidth
      tmp.height = img.naturalHeight
      tmp.getContext('2d').drawImage(img, 0, 0)
      src = rotateCanvas(tmp, 90)
    }
    x.drawImage(src, (W - cardW) / 2, y, cardW, cardH)
    x.strokeStyle = '#d0d0d0'
    x.lineWidth = 2
    x.strokeRect((W - cardW) / 2, y, cardW, cardH)
    URL.revokeObjectURL(img.src)
    if (tmp) {
      releaseCanvas(src)
      releaseCanvas(tmp)
    }
    y += cardH + gap
  }
  const page = { id: uid(), ...(await canvasToPage(c)), text: '', rotation: 0 }
  releaseCanvas(c)
  return page
}
