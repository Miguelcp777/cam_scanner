// Búsqueda local por nombre y por el texto reconocido (OCR), sin distinguir mayúsculas ni tildes.
import { listDocs } from './db'

export const normalize = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function docText(d) {
  return d.kind === 'scan' ? d.pages.map((p) => p.text).filter(Boolean).join('\n') : d.text || ''
}

// Fragmento de texto alrededor de la primera coincidencia
function snippet(text, term) {
  const i = normalize(text).indexOf(term)
  if (i < 0) return ''
  const start = Math.max(0, i - 50)
  const end = Math.min(text.length, i + term.length + 70)
  return (start ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '')
}

// Todas las palabras deben aparecer (en el nombre o en el texto). Coincidencias en el nombre primero.
export async function searchDocs(query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const out = []
  for (const d of await listDocs()) {
    const name = normalize(`${d.name} ${(d.tags || []).join(' ')}`)
    const text = docText(d)
    const ntext = normalize(text)
    if (!terms.every((t) => name.includes(t) || ntext.includes(t))) continue
    const inName = terms.some((t) => name.includes(t))
    const first = terms.find((t) => ntext.includes(t))
    out.push({ doc: d, inName, snippet: first ? snippet(text, first) : '' })
  }
  return out.sort((a, b) => b.inName - a.inName || b.doc.updatedAt - a.doc.updatedAt)
}
