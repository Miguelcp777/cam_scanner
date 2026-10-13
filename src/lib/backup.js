// Copia de seguridad completa en un único .zip:
//   manifest.json  → documentos, carpetas y firmas sin los binarios (con referencias a archivos)
//   files/…        → imágenes y PDF tal cual (sin recomprimir)
import { exportAll, importRecords } from './db'

const FORMAT = 'docscan-backup'
const VERSION = 1

const extOf = (blob) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' })[blob.type] || 'bin'

const typeOf = (path) =>
  ({ jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' })[path.split('.').pop()] || 'application/octet-stream'

async function loadZip() {
  const mod = await import('jszip')
  return mod.default ?? mod
}

export async function createBackup(onProgress = () => {}) {
  const JSZip = await loadZip()
  const zip = new JSZip()
  const { docs, folders, signatures } = await exportAll()
  let n = 0
  // Sustituye cada Blob por la ruta del archivo dentro del zip
  const put = (blob, path) => {
    if (!blob) return null
    const file = `files/${path}.${extOf(blob)}`
    zip.file(file, blob)
    n++
    return file
  }
  const manifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    folders,
    signatures: signatures.map((s) => ({ ...s, blob: put(s.blob, `firmas/${s.id}`) })),
    docs: docs.map((d) => ({
      ...d,
      pdf: put(d.pdf, `${d.id}/documento`),
      thumb: put(d.thumb, `${d.id}/miniatura`),
      pages: (d.pages || []).map((p) => ({
        ...p,
        blob: put(p.blob, `${d.id}/${p.id}`),
        original: put(p.original, `${d.id}/${p.id}-original`),
      })),
    })),
  }
  zip.file('manifest.json', JSON.stringify(manifest))
  // Las imágenes y PDF ya están comprimidos: STORE evita gastar CPU/batería en el móvil
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => onProgress(m.percent / 100))
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return {
    blob: new Blob([blob], { type: 'application/zip' }),
    name: `docscan-copia-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.zip`,
    counts: { docs: docs.length, folders: folders.length, signatures: signatures.length, files: n },
  }
}

// Lee la copia y devuelve los registros listos para guardar (sin escribir todavía) + resumen
export async function readBackup(file) {
  const JSZip = await loadZip()
  const zip = await JSZip.loadAsync(file)
  const mf = zip.file('manifest.json')
  if (!mf) throw new Error('El archivo no es una copia de seguridad de DocScan.')
  const manifest = JSON.parse(await mf.async('string'))
  if (manifest.format !== FORMAT) throw new Error('El archivo no es una copia de seguridad de DocScan.')
  if (manifest.version > VERSION) throw new Error('La copia es de una versión más nueva de DocScan. Actualiza la app.')
  const get = async (path) => {
    if (!path) return null
    const f = zip.file(path)
    if (!f) throw new Error(`Falta el archivo ${path} en la copia.`)
    return new Blob([await f.async('arraybuffer')], { type: typeOf(path) })
  }
  const signatures = await Promise.all(manifest.signatures.map(async (s) => ({ ...s, blob: await get(s.blob) })))
  const docs = []
  for (const d of manifest.docs) {
    docs.push({
      ...d,
      pdf: await get(d.pdf),
      thumb: await get(d.thumb),
      pages: await Promise.all((d.pages || []).map(async (p) => ({ ...p, blob: await get(p.blob), original: await get(p.original) }))),
    })
  }
  return { createdAt: manifest.createdAt, docs, folders: manifest.folders, signatures }
}

export async function restoreBackup(data) {
  await importRecords(data)
}
