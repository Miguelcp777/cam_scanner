// Almacenamiento local en IndexedDB.
// doc:    { id, name, kind: 'scan' | 'pdf', folderId, createdAt, updatedAt, deletedAt, pageCount,
//           pages: [page]                                 (kind 'scan')
//           pdf: Blob, thumb: Blob, text: string          (kind 'pdf') }
// page:   { id, blob (resultado), width, height, text,
//           original (foto de trabajo ≤3000 px), points, filter, flatten, rotation }  ← para poder reeditar
// folder:    { id, name, parentId, createdAt }
// signature: { id, blob (PNG transparente), width, height, createdAt }
import { openDB } from 'idb'
import { toRaw } from 'vue'

const dbPromise = openDB('docscan', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('docs', { keyPath: 'id' })
      db.createObjectStore('folders', { keyPath: 'id' })
    }
    if (oldVersion < 2) db.createObjectStore('signatures', { keyPath: 'id' })
  },
})

export const uid = () => crypto.randomUUID()

export function plainPage(p) {
  const r = toRaw(p)
  return {
    id: r.id,
    blob: toRaw(r.blob),
    width: r.width,
    height: r.height,
    text: r.text ?? '',
    original: r.original ? toRaw(r.original) : null,
    points: r.points ? toRaw(r.points).map((q) => ({ x: q.x, y: q.y })) : null,
    filter: r.filter ?? null,
    flatten: r.flatten ?? null,
    rotation: r.rotation ?? 0,
  }
}

// IndexedDB no puede clonar Proxies de Vue: reconstruimos objetos planos.
function plainDoc(doc) {
  const d = toRaw(doc)
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    folderId: d.folderId ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt ?? null,
    pageCount: d.pageCount ?? null,
    pdf: d.pdf ? toRaw(d.pdf) : null,
    thumb: d.thumb ? toRaw(d.thumb) : null,
    text: d.text ?? '',
    pages: (toRaw(d.pages) || []).map(plainPage),
  }
}

async function allDocs() {
  return (await dbPromise).getAll('docs')
}

// Documentos activos (fuera de la papelera), más recientes primero
export async function listDocs() {
  return (await allDocs()).filter((d) => !d.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getDoc(id) {
  return (await dbPromise).get('docs', id)
}

export async function saveDoc(doc, { touch = true } = {}) {
  const d = plainDoc(doc)
  if (touch || !d.updatedAt) d.updatedAt = Date.now()
  if (d.kind === 'scan') d.pageCount = d.pages.length
  await (await dbPromise).put('docs', d)
  return d
}

export function createScanDoc({ name, pages, folderId = null }) {
  const now = Date.now()
  return saveDoc({ id: uid(), name, kind: 'scan', folderId, createdAt: now, pages })
}

export function createPdfDoc({ name, blob, pageCount = null, thumb = null, folderId = null }) {
  const now = Date.now()
  return saveDoc({ id: uid(), name, kind: 'pdf', folderId, createdAt: now, pdf: blob, pageCount, thumb, pages: [] })
}

// --- Papelera: los documentos se conservan TRASH_DAYS días antes de borrarse definitivamente ---
export const TRASH_DAYS = 30

export async function trashDoc(id) {
  const d = await getDoc(id)
  if (d) await saveDoc({ ...d, deletedAt: Date.now() }, { touch: false })
}

export async function restoreDoc(id) {
  const d = await getDoc(id)
  if (d) await saveDoc({ ...d, deletedAt: null })
}

export async function purgeDoc(id) {
  await (await dbPromise).delete('docs', id)
}

export async function listTrash() {
  return (await allDocs()).filter((d) => d.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt)
}

export async function emptyTrash() {
  for (const d of await listTrash()) await purgeDoc(d.id)
}

// Borra lo que lleva más de TRASH_DAYS días en la papelera (se llama al arrancar la app)
export async function purgeOldTrash() {
  const limit = Date.now() - TRASH_DAYS * 86400000
  for (const d of await listTrash()) if (d.deletedAt < limit) await purgeDoc(d.id)
}

// --- Firmas ---
export async function listSignatures() {
  const sigs = await (await dbPromise).getAll('signatures')
  return sigs.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveSignature({ blob, width, height }) {
  const sig = { id: uid(), blob, width, height, createdAt: Date.now() }
  await (await dbPromise).put('signatures', sig)
  return sig
}

export async function deleteSignature(id) {
  await (await dbPromise).delete('signatures', id)
}

// --- Carpetas ---
export async function listFolders() {
  const folders = await (await dbPromise).getAll('folders')
  return folders.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveFolder(folder) {
  const f = { ...toRaw(folder) }
  await (await dbPromise).put('folders', f)
  return f
}

export function createFolder(name, parentId = null) {
  return saveFolder({ id: uid(), name, parentId, createdAt: Date.now() })
}

// Al borrar una carpeta, su contenido sube a la carpeta padre.
export async function deleteFolder(id) {
  const db = await dbPromise
  const folder = await db.get('folders', id)
  if (!folder) return
  const tx = db.transaction(['docs', 'folders'], 'readwrite')
  for (const d of await tx.objectStore('docs').getAll()) {
    if (d.folderId === id) await tx.objectStore('docs').put({ ...d, folderId: folder.parentId })
  }
  for (const f of await tx.objectStore('folders').getAll()) {
    if (f.parentId === id) await tx.objectStore('folders').put({ ...f, parentId: folder.parentId })
  }
  await tx.objectStore('folders').delete(id)
  await tx.done
}

// --- Copia de seguridad ---
export async function exportAll() {
  const db = await dbPromise
  return { docs: await db.getAll('docs'), folders: await db.getAll('folders'), signatures: await db.getAll('signatures') }
}

// Restaura registros completos; los que tienen el mismo id se sobrescriben.
export async function importRecords({ docs = [], folders = [], signatures = [] }) {
  const db = await dbPromise
  const tx = db.transaction(['docs', 'folders', 'signatures'], 'readwrite')
  for (const f of folders) await tx.objectStore('folders').put(f)
  for (const s of signatures) await tx.objectStore('signatures').put(s)
  for (const d of docs) await tx.objectStore('docs').put(d)
  await tx.done
}
