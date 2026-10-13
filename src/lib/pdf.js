import { PDFDocument } from 'pdf-lib'

const A4_WIDTH = 595.28 // puntos

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
