import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const A4_WIDTH = 595.28 // puntos

// --- Organizar páginas de un PDF: order = [{ index (página original, base 0), rotate (0/90/180/270) }] ---
export async function rearrangePdf(blob, order) {
  const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, order.map((o) => o.index))
  pages.forEach((p, i) => {
    if (order[i].rotate) p.setRotation(degrees((p.getRotation().angle + order[i].rotate) % 360))
    out.addPage(p)
  })
  return new Blob([await out.save()], { type: 'application/pdf' })
}

// --- Exportar con opciones ---
export const QUALITIES = {
  original: { label: 'Original', note: 'máxima calidad' },
  medium: { label: 'Media', note: 'buena para enviar por correo', side: 1600, q: 0.72 },
  small: { label: 'Pequeña', note: 'mínimo tamaño (WhatsApp, formularios)', side: 1100, q: 0.58 },
}

async function recompress(blob, { side, q }) {
  const { loadImage, canvasToBlob, releaseCanvas } = await import('./scan')
  const img = await loadImage(blob)
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k)
  c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(img.src)
  const out = await canvasToBlob(c, 'image/jpeg', q)
  releaseCanvas(c)
  return out
}

// Marca de agua en diagonal, centrada y repetida, semitransparente
async function addWatermark(bytes, text) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const clean = text.replace(/[^\x20-\x7E -ÿ]/g, '').trim() // Helvetica estándar: solo Latin-1
  if (!clean) return bytes
  const a = Math.PI / 4
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize()
    // Tamaño para que el texto en diagonal quepa holgado en el ancho de la página
    const size = Math.min((width * 0.7) / (font.widthOfTextAtSize(clean, 1) * Math.cos(a)), height / 14)
    const tw = font.widthOfTextAtSize(clean, size)
    // Altura que ocupa el texto en diagonal; las repeticiones se reparten sin salirse de la página
    const ext = tw * Math.sin(a) + size
    const top = height - ext / 2 - 20
    const bottom = ext / 2 + 20
    const ys = top > bottom ? [bottom, (bottom + top) / 2, top] : [height / 2]
    for (const cy of ys) {
      const cx = width / 2
      page.drawText(clean, {
        x: cx - (tw / 2) * Math.cos(a) + (size / 3) * Math.sin(a),
        y: cy - (tw / 2) * Math.sin(a) - (size / 3) * Math.cos(a),
        size,
        font,
        color: rgb(0.45, 0.45, 0.45),
        opacity: 0.22,
        rotate: degrees(45),
      })
    }
  }
  return pdf.save()
}

// Cifrado AES-256 (librería con soporte de cifrado, cargada solo si se usa)
async function encrypt(bytes, password) {
  const { PDFDocument: EncPDF } = await import('@cantoo/pdf-lib')
  const doc = await EncPDF.load(bytes)
  const owner = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  doc.encrypt({ userPassword: password, ownerPassword: owner, permissions: { printing: 'highResolution', copying: true } })
  return doc.save()
}

// options: { quality: 'original'|'medium'|'small', watermark: string, password: string }
// Devuelve { blob, note } (note explica si no se pudo reducir el tamaño)
export async function exportPdf(doc, { quality = 'original', watermark = '', password = '' } = {}, onProgress = () => {}) {
  const qa = QUALITIES[quality]
  let bytes
  let note = ''
  if (qa?.side) {
    // Escaneos: recomprimir cada página. PDF: se rasterizan sus páginas (el texto deja de ser seleccionable).
    const { pageImages } = await import('./pages')
    const blobs = doc.kind === 'scan' ? doc.pages.map((p) => p.blob) : await pageImages(doc, { maxSide: qa.side })
    const pages = []
    for (const [i, b] of blobs.entries()) {
      pages.push({ blob: await recompress(b, qa) })
      onProgress((i + 1) / blobs.length)
    }
    bytes = await scanToPdfBytes(pages)
    // Un PDF de texto ya es pequeño: convertirlo en imágenes lo agrandaría
    const original = await docToPdfBytes(doc)
    if (bytes.byteLength >= original.byteLength) {
      bytes = original
      note = 'Este PDF ya ocupa poco (es texto, no imágenes): se mantiene la calidad original.'
    }
  } else {
    bytes = await docToPdfBytes(doc)
  }
  if (watermark.trim()) bytes = await addWatermark(bytes, watermark)
  if (password) bytes = await encrypt(bytes, password)
  return { blob: new Blob([bytes], { type: 'application/pdf' }), note }
}

async function scanToPdfBytes(pages) {
  const pdf = await PDFDocument.create()
  for (const p of pages) {
    const bytes = await p.blob.arrayBuffer()
    const img = p.blob.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    const height = (A4_WIDTH * img.height) / img.width
    pdf.addPage([A4_WIDTH, height]).drawImage(img, { x: 0, y: 0, width: A4_WIDTH, height })
  }
  return pdf.save()
}

export async function docToPdfBytes(doc) {
  if (doc.kind === 'pdf') return new Uint8Array(await doc.pdf.arrayBuffer())
  return scanToPdfBytes(doc.pages)
}

export async function docToPdfBlob(doc) {
  if (doc.kind === 'pdf') return doc.pdf
  return new Blob([await docToPdfBytes(doc)], { type: 'application/pdf' })
}

export async function countPdfPages(blob) {
  const pdf = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })
  return pdf.getPageCount()
}

async function copyInto(out, bytes, indices) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = await out.copyPages(src, indices ?? src.getPageIndices())
  pages.forEach((p) => out.addPage(p))
}

export async function mergeDocs(docs) {
  const out = await PDFDocument.create()
  for (const d of docs) await copyInto(out, await docToPdfBytes(d), null)
  return { blob: new Blob([await out.save()], { type: 'application/pdf' }), pageCount: out.getPageCount() }
}

export async function extractPages(doc, indices) {
  const out = await PDFDocument.create()
  await copyInto(out, await docToPdfBytes(doc), indices)
  return { blob: new Blob([await out.save()], { type: 'application/pdf' }), pageCount: out.getPageCount() }
}

// placements: [{ page (índice base 0), sigId, x, y, w, h }] en fracciones de la página, origen arriba-izquierda.
// Limitación: no tiene en cuenta páginas rotadas ni CropBox distinto de MediaBox.
export async function stampSignatures(doc, placements, signatures) {
  const pdf = await PDFDocument.load(await docToPdfBytes(doc), { ignoreEncryption: true })
  const embedded = {}
  for (const p of placements) {
    embedded[p.sigId] ??= await pdf.embedPng(await signatures[p.sigId].blob.arrayBuffer())
    const page = pdf.getPage(p.page)
    const { width, height } = page.getSize()
    page.drawImage(embedded[p.sigId], {
      x: p.x * width,
      y: height - (p.y + p.h) * height,
      width: p.w * width,
      height: p.h * height,
    })
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}

// "1-3, 5, 8-6" -> índices base 0. Lanza Error si el rango no es válido.
export function parseRanges(text, max) {
  const out = []
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) throw new Error(`Rango no válido: "${part}"`)
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (a < 1 || b < 1 || a > max || b > max) throw new Error(`"${part}" está fuera de 1-${max}`)
    const step = a <= b ? 1 : -1
    for (let i = a; i !== b + step; i += step) out.push(i - 1)
  }
  if (!out.length) throw new Error('Indica al menos una página')
  return out
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
