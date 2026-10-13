// Exportar archivos: hoja "Compartir" del sistema (iPhone: Guardar en Fotos/Archivos, WhatsApp…)
// o descarga clásica. Safari exige que share() salga de un toque reciente del usuario, por eso
// la UI muestra un botón "Compartir" cuando el archivo ya está generado.
import { downloadBlob } from './pdf'

const toFiles = (results) => results.map((r) => new File([r.blob], r.name, { type: r.blob.type }))

export function canShareFiles(results) {
  try {
    return !!navigator.canShare?.({ files: toFiles(results) })
  } catch {
    return false
  }
}

// true si se compartió o el usuario canceló; false si hay que recurrir a la descarga.
export async function shareFiles(results) {
  try {
    await navigator.share({ files: toFiles(results) })
    return true
  } catch (e) {
    return e.name === 'AbortError'
  }
}

export function downloadAll(results) {
  results.forEach((r, i) => setTimeout(() => downloadBlob(r.blob, r.name), i * 400))
}
