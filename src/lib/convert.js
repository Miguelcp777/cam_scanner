// Conversiones en el navegador. Devuelven [{ blob, name }].
import { groupRows, paragraphs, toTable } from './layout'
import { pageImages, pageLayouts } from './pages'

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const TARGETS = {
  word: { label: 'Word', ext: 'docx', ico: '📝', run: toWord },
  excel: { label: 'Excel', ext: 'xlsx', ico: '📊', run: toExcel },
  ppt: { label: 'PowerPoint', ext: 'pptx', ico: '📽️', run: toPpt },
  image: { label: 'Imagen (JPG)', ext: 'jpg', ico: '🖼️', run: toImages },
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'documento'

async function toWord(doc, onProgress) {
  const layouts = await pageLayouts(doc, (p) => onProgress(p * 0.9))
  const { Document, Packer, Paragraph, TextRun } = await import('docx')
  const sections = layouts.map((l) => {
    const paras = paragraphs(groupRows(l.items)).map(
      (p) =>
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: p.text, bold: p.heading, size: Math.round(22 * Math.min(2, Math.max(1, p.size))) })],
        }),
    )
    return { children: paras.length ? paras : [new Paragraph('')] }
  })
  const blob = await Packer.toBlob(new Document({ sections }))
  onProgress(1)
  return [{ blob: new Blob([blob], { type: MIME.docx }), name: `${safeName(doc.name)}.docx` }]
}

// "1.250,00" / "1250.5" → número; el resto queda como texto.
function toCell(s) {
  const t = s.trim()
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return Number(t)
  return t
}

async function toExcel(doc, onProgress) {
  const layouts = await pageLayouts(doc, (p) => onProgress(p * 0.9))
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const wb = new ExcelJS.Workbook()
  layouts.forEach((l, i) => {
    const ws = wb.addWorksheet(`Página ${i + 1}`)
    for (const row of toTable(groupRows(l.items), l.width)) ws.addRow(row.map(toCell))
    ws.columns?.forEach((col) => {
      let w = 8
      col.eachCell({ includeEmpty: false }, (c) => (w = Math.max(w, String(c.value ?? '').length + 2)))
      col.width = Math.min(w, 60)
    })
  })
  const buffer = await wb.xlsx.writeBuffer()
  onProgress(1)
  return [{ blob: new Blob([buffer], { type: MIME.xlsx }), name: `${safeName(doc.name)}.xlsx` }]
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })

async function imageSize(blob) {
  const bmp = await createImageBitmap(blob)
  const s = { w: bmp.width, h: bmp.height }
  bmp.close()
  return s
}

// Una diapositiva por página, con la página como imagen.
async function toPpt(doc, onProgress) {
  const images = await pageImages(doc, { maxSide: 1600, onProgress: (p) => onProgress(p * 0.7) })
  const mod = await import('pptxgenjs')
  const PptxGenJS = mod.default ?? mod
  const pptx = new PptxGenJS()
  const first = await imageSize(images[0])
  const W = first.w >= first.h ? 10 : 7.5
  const H = (W * first.h) / first.w
  pptx.defineLayout({ name: 'DOC', width: W, height: H })
  pptx.layout = 'DOC'
  for (const [i, img] of images.entries()) {
    const s = await imageSize(img)
    const k = Math.min(W / s.w, H / s.h)
    const w = s.w * k
    const h = s.h * k
    pptx.addSlide().addImage({ data: await blobToDataUrl(img), x: (W - w) / 2, y: (H - h) / 2, w, h })
    onProgress(0.7 + (0.3 * (i + 1)) / images.length)
  }
  const blob = await pptx.write({ outputType: 'blob' })
  return [{ blob: new Blob([blob], { type: MIME.pptx }), name: `${safeName(doc.name)}.pptx` }]
}

async function toImages(doc, onProgress) {
  const images = await pageImages(doc, { maxSide: 2400, onProgress })
  const base = safeName(doc.name)
  return images.map((blob, i) => ({ blob, name: images.length > 1 ? `${base}-p${i + 1}.jpg` : `${base}.jpg` }))
}
