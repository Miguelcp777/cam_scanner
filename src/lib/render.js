// Renderizado de PDF con pdf.js (carga bajo demanda).
import { canvasToBlob, releaseCanvas } from './scan'

let pdfjsPromise = null

function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([lib, worker]) => {
        lib.GlobalWorkerOptions.workerSrc = worker.default
        return { lib }
      },
    )
  }
  return pdfjsPromise
}

// pdf.js transfiere (vacía) el buffer: se lee uno nuevo del Blob en cada apertura.
export async function openPdf(blob) {
  const { lib } = await pdfjs()
  return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
}

// iOS limita el tamaño y la memoria total de los canvas: maxSide acota la resolución.
export async function renderPage(page, maxSide = 2000) {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas
}

export async function renderPageBlob(page, maxSide) {
  const canvas = await renderPage(page, maxSide)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
  releaseCanvas(canvas)
  return blob
}

// Miniatura de la primera página y número de páginas.
export async function pdfInfo(blob) {
  const pdf = await openPdf(blob)
  try {
    return { thumb: await renderPageBlob(await pdf.getPage(1), 400), pageCount: pdf.numPages }
  } finally {
    pdf.destroy()
  }
}
