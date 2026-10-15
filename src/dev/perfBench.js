// Perfil de tiempos del escaneo de una foto (solo desarrollo; la app no lo importa).
// Uso, desde la consola del navegador con `npm run dev`:
//   const p = await import('/src/dev/perfBench.js'); console.table(await p.runPerfBench())
// Nota: en un panel o pestaña en segundo plano el navegador ralentiza la CPU; medir con la pestaña visible.
import { photo, FLATTEN_CASES } from './scanBench'
import { cropPage, findCorners, loadSource, renderPage, canvasToPage } from '../lib/process'
import { releaseCanvas } from '../lib/scan'

const PHOTO = { W: 3024, H: 4032, f: 3000 } // 12 MP, como la cámara del iPhone

async function step(rows, name, fn) {
  const t = performance.now()
  const r = await fn()
  rows[name] = Math.round(performance.now() - t)
  return r
}

export async function runPerfBench(cases = { 'A4 plana': FLATTEN_CASES['A4 plana (control)'], 'Tique enrollado': FLATTEN_CASES['Tique enrollado arriba'] }) {
  const out = []
  for (const [name, cfg] of Object.entries(cases)) {
    const { canvas: shot } = await photo({ ...cfg, ...PHOTO })
    const blob = await new Promise((r) => shot.toBlob(r, 'image/jpeg', 0.9))
    releaseCanvas(shot)
    const row = { caso: name }
    const t0 = performance.now()
    const { canvas, originalP } = await step(row, 'cargar', () => loadSource(blob))
    const { points, detected } = await step(row, 'detectar', () => findCorners(canvas))
    const { warped, flattened } = await step(row, 'recortar+aplanar', () => cropPage(canvas, points, { snap: detected }))
    const outCanvas = await step(row, 'filtro', () => renderPage(warped))
    await step(row, 'jpeg', () => Promise.all([canvasToPage(outCanvas), originalP]))
    row.total = Math.round(performance.now() - t0)
    row.aplanado = flattened || 'no'
    ;[canvas, warped, outCanvas].forEach(releaseCanvas)
    out.push(row)
  }
  return out
}
