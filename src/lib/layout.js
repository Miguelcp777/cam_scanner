// Reconstrucción de líneas, párrafos y tablas a partir de fragmentos de texto posicionados
// ({ text, x, y, w, h } con origen arriba a la izquierda). Heurística, no exacta.

const median = (arr) => {
  if (!arr.length) return 1
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] || 1
}

export function groupRows(items) {
  const rows = []
  for (const it of [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const cy = it.y + it.h / 2
    const last = rows.at(-1)
    if (last && Math.abs(cy - last.cy) < Math.max(it.h, last.h) * 0.55) {
      last.items.push(it)
      last.cy += (cy - last.cy) / last.items.length
      last.h = Math.max(last.h, it.h)
    } else {
      rows.push({ cy, h: it.h, items: [it] })
    }
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x)
    r.top = Math.min(...r.items.map((i) => i.y))
    r.bottom = Math.max(...r.items.map((i) => i.y + i.h))
    r.hMed = median(r.items.map((i) => i.h)) // robusto frente a símbolos sueltos muy altos
  }
  return rows
}

// Une fragmentos cercanos de una fila en celdas; un hueco grande separa celdas.
export function splitCells(row) {
  const cells = []
  for (const it of row.items) {
    const prev = cells.at(-1)
    const gap = prev ? it.x - prev.right : Infinity
    if (prev && gap < row.h * 1.2) {
      prev.text += (gap > row.h * 0.15 && !prev.text.endsWith(' ') ? ' ' : '') + it.text
      prev.right = Math.max(prev.right, it.x + it.w)
    } else {
      cells.push({ text: it.text, x: it.x, right: it.x + it.w })
    }
  }
  return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text)
}

// Párrafos: une líneas seguidas de una sola celda; las líneas altas se marcan como títulos.
export function paragraphs(rows) {
  const base = median(rows.map((r) => r.hMed))
  const out = []
  for (const r of rows) {
    const cells = splitCells(r)
    if (!cells.length) continue
    const text = cells.map((c) => c.text).join('    ')
    const size = r.hMed / base
    const heading = size > 1.3
    const prev = out.at(-1)
    const joinable = prev && !heading && !prev.heading && cells.length === 1 && prev.cells === 1
    if (joinable && r.top - prev.bottom < r.h * 0.8) {
      prev.text += (prev.text.endsWith('-') ? '' : ' ') + text
      prev.bottom = r.bottom
    } else {
      out.push({ text, bottom: r.bottom, heading, size, cells: cells.length })
    }
  }
  return out
}

export function layoutText(layout) {
  if (layout.source === 'ocr') return layout.text
  return paragraphs(groupRows(layout.items))
    .map((p) => p.text)
    .join('\n')
}

// Tabla: columnas comunes a toda la página agrupando las posiciones x de las celdas.
export function toTable(rows, pageWidth) {
  const rowCells = rows.map(splitCells).filter((c) => c.length)
  const tol = pageWidth * 0.025
  const cols = []
  for (const x of rowCells.flat().map((c) => c.x).sort((a, b) => a - b)) {
    const last = cols.at(-1)
    if (last && x - last.last <= tol) {
      last.sum += x
      last.n++
      last.last = x
    } else {
      cols.push({ sum: x, n: 1, last: x })
    }
  }
  const centers = cols.map((c) => c.sum / c.n)
  return rowCells.map((cells) => {
    const row = Array(centers.length).fill('')
    for (const c of cells) {
      let k = 0
      centers.forEach((x, i) => Math.abs(c.x - x) < Math.abs(c.x - centers[k]) && (k = i))
      row[k] = row[k] ? `${row[k]} ${c.text}` : c.text
    }
    while (row.length && row.at(-1) === '') row.pop()
    return row
  })
}
