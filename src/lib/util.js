import { useRouter } from 'vue-router'
import { createPdfDoc } from './db'
import { countPdfPages } from './pdf'
import { pdfInfo } from './render'

export const isTouch = () => matchMedia('(pointer: coarse)').matches
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches

// Guarda un PDF con su miniatura y número de páginas (si pdf.js no puede leerlo, sin miniatura).
export async function savePdf({ name, blob, folderId = null }) {
  const info = await pdfInfo(blob).catch(() => null)
  const pageCount = info?.pageCount ?? (await countPdfPages(blob).catch(() => null))
  return createPdfDoc({ name, blob, folderId, pageCount, thumb: info?.thumb ?? null })
}

// Imágenes pendientes de pasar por el escáner (desde Inicio, Mi documento o arrastrar y soltar).
export const pending = { files: [], folderId: null }

const urls = new WeakMap()
export function blobUrl(blob) {
  if (!blob) return ''
  let u = urls.get(blob)
  if (!u) {
    u = URL.createObjectURL(blob)
    urls.set(blob, u)
  }
  return u
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

export function defaultScanName() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `Escaneo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

// PDFs se guardan directamente; imágenes van al escáner para recortar y filtrar.
export function useImport() {
  const router = useRouter()
  async function handleFiles(fileList, folderId = null) {
    const files = [...fileList]
    const images = files.filter((f) => f.type.startsWith('image/'))
    const pdfs = files.filter(isPdf)
    for (const f of pdfs) await savePdf({ name: f.name.replace(/\.pdf$/i, ''), blob: f, folderId })
    const skipped = files.length - images.length - pdfs.length
    if (images.length) {
      pending.files = images
      pending.folderId = folderId
      router.push('/scanner')
    }
    return { images: images.length, pdfs: pdfs.length, skipped }
  }
  return { handleFiles }
}
