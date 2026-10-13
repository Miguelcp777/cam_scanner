// El módulo de OpenCV.js es un "thenable" (Module.then de Emscripten). Si se importa
// dinámicamente o se devuelve desde una promesa, la promesa intenta adoptarlo en bucle
// infinito y congela la página. Por eso se importa de forma estática aquí y solo se
// expone envuelto en un objeto { cv }.
import cv from '@techstark/opencv-js'

export function ready() {
  return new Promise((resolve) => {
    if (cv.Mat) return resolve({ cv })
    const prev = cv.onRuntimeInitialized
    cv.onRuntimeInitialized = () => {
      prev?.()
      resolve({ cv })
    }
    const t = setInterval(() => {
      if (cv.Mat) {
        clearInterval(t)
        resolve({ cv })
      }
    }, 100)
  })
}
