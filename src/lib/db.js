// Almacenamiento local en IndexedDB.
// doc:    { id, name, kind: 'scan' | 'pdf', folderId, createdAt, updatedAt, pageCount,
//           pages: [{ id, blob, width, height, text }]   (kind 'scan')
//           pdf: Blob, thumb: Blob, text: string          (kind 'pdf') }
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
    pageCount: d.pageCount ?? null,
    pdf: d.pdf ? toRaw(d.pdf) : null,
    thumb: d.thumb ? toRaw(d.thumb) : null,
    text: d.text ?? '',
    pages: (toRaw(d.pages) || []).map((p) => {
      const r = toRaw(p)
      return { id: r.id, blob: r.blob, width: r.width, height: r.height, text: r.text ?? '' }
    }),
  }
}

export async function listDocs() {
  const docs = await (await dbPromise).getAll('docs')
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getDoc(id) {
  return (await dbPromise).get('docs', id)
}

export async function saveDoc(doc) {
  const d = plainDoc(doc)
  d.updatedAt = Date.now()
  if (d.kind === 'scan') d.pageCount = d.pages.length
  await (await dbPromise).put('docs', d)
  return d
}

export async function deleteDoc(id) {
  await (await dbPromise).delete('docs', id)
}

export function createScanDoc({ name, pages, folderId = null }) {
  const now = Date.now()
  return saveDoc({ id: uid(), name, kind: 'scan', folderId, createdAt: now, pages })
}

export function createPdfDoc({ name, blob, pageCount = null, thumb = null, folderId = null }) {
  const now = Date.now()
  return saveDoc({ id: uid(), name, kind: 'pdf', folderId, createdAt: now, pdf: blob, pageCount, thumb, pages: [] })
}

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
