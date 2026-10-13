// Detección de datos sensibles en el texto posicionado de una página (capa de texto o OCR).
// Devuelve recuadros en coordenadas del layout. Se trabaja por renglones para encontrar datos
// repartidos en varias palabras (p. ej. "600 123 456" o un IBAN con espacios).
import { groupRows } from './layout'
import { normalize } from './search'

export const PATTERNS = {
  email: { label: 'Correos electrónicos', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g },
  phone: { label: 'Teléfonos', re: /(?:\+?\d{2,3}[\s.-]?)?[6789]\d{2}[\s.-]?\d{2,3}[\s.-]?\d{2,3}(?:[\s.-]?\d{2})?/g },
  id: { label: 'DNI / NIE', re: /\b[xyz]?[\s-]?\d{7,8}[\s-]?[a-z]\b/g },
  iban: { label: 'IBAN y tarjetas', re: /\b[a-z]{2}\d{2}(?:\s?[a-z0-9]{4}){4,7}\b|\b(?:\d{4}[\s-]?){3}\d{4}\b/g },
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// terms: texto libre separado por comas; patterns: claves de PATTERNS activadas
export function findSensitive(layout, { terms = '', patterns = [] } = {}) {
  const regs = patterns.map((k) => new RegExp(PATTERNS[k].re.source, 'g'))
  for (const t of terms.split(',').map((x) => normalize(x.trim())).filter(Boolean)) {
    regs.push(new RegExp(escapeRe(t).replace(/\s+/g, '\\s+'), 'g'))
  }
  if (!regs.length) return []
  const boxes = []
  for (const row of groupRows(layout.items)) {
    // Texto normalizado del renglón y posición de cada palabra dentro de él
    let text = ''
    const spans = row.items.map((it) => {
      if (text) text += ' '
      const start = text.length
      text += normalize(it.text)
      return { it, start, end: text.length }
    })
    for (const re of regs) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        if (!m[0].trim()) {
          re.lastIndex++
          continue
        }
        const a = m.index, b = m.index + m[0].length
        const hit = spans.filter((s) => s.start < b && s.end > a)
        if (!hit.length) continue
        // Dentro de cada fragmento solo se tapa la parte coincidente (anchura proporcional a los caracteres):
        // en un PDF un renglón entero puede ser un solo fragmento ("Email: juan@…")
        const xs = hit.map((s) => {
          const len = Math.max(1, s.end - s.start)
          // Margen de seguridad de ~1 carácter: la anchura real de cada letra varía (mejor tapar de más)
          const lo = Math.max(0, a - s.start - 1.2) / len
          const hi = Math.min(len, b - s.start + 0.8) / len
          return [s.it.x + s.it.w * lo, s.it.x + s.it.w * hi]
        })
        const x0 = Math.min(...xs.map((v) => v[0])), x1 = Math.max(...xs.map((v) => v[1]))
        const y0 = Math.min(...hit.map((s) => s.it.y)), y1 = Math.max(...hit.map((s) => s.it.y + s.it.h))
        const pad = (y1 - y0) * 0.2
        boxes.push({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad })
      }
    }
  }
  return boxes
}
