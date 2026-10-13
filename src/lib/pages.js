// Acceso uniforme a las páginas de cualquier documento (escaneo o PDF).
import { recognizeLayouts } from './ocr'
import { openPdf, renderPageBlob } from './render'

// Imágenes JPEG de cada página.
export async function pageImages(doc, { maxSide = 2000, onProgress = () => {} } = {}) {
  if (doc.kind === 'scan') return doc.pages.map((p) => p.blob)
  const pdf = await openPdf(doc.pdf)
  const out = []
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      out.push(await renderPageBlob(await pdf.getPage(i), maxSide))
      onProgress(i / pdf.numPages)
    }
  } finally {
    pdf.destroy()
  }
  return out
}

const MIN_CHARS = 20 // menos texto que esto en una página PDF → se trata como escaneada (OCR)

// Texto posicionado por página: capa de texto del PDF si existe; si no, OCR.
export async function pageLayouts(doc, onProgress = () => {}) {
  if (doc.kind === 'scan') return recognizeLayouts(doc.pages.map((p) => p.blob), onProgress)
  const pdf = await openPdf(doc.pdf)
  const out = []
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const { items } = await page.getTextContent()
      const texts = items
        .filter((it) => it.str?.trim())
        .map((it) => {
          const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5])
          const h = Math.hypot(it.transform[2], it.transform[3]) || 10
          return { text: it.str, x, y: y - h, w: it.width, h }
        })
      if (texts.reduce((n, t) => n + t.text.trim().length, 0) >= MIN_CHARS) {
        out.push({ width: viewport.width, height: viewport.height, items: texts, source: 'pdf' })
      } else {
        const blob = await renderPageBlob(page, 2000)
        out.push((await recognizeLayouts([blob]))[0])
      }
      onProgress(i / pdf.numPages)
    }
  } finally {
    pdf.destroy()
  }
  return out
}
