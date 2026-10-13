// OCR con Tesseract.js. Los modelos de idioma (spa+eng) se descargan del CDN la primera vez.

async function withWorker(images, onProgress, fn) {
  const { createWorker } = await import('tesseract.js')
  let current = 0
  const worker = await createWorker('spa+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress((current + m.progress) / images.length)
    },
  })
  const out = []
  try {
    for (current = 0; current < images.length; current++) out.push(await fn(worker, images[current]))
  } finally {
    await worker.terminate()
  }
  onProgress(1)
  return out
}

export function recognize(images, onProgress = () => {}) {
  return withWorker(images, onProgress, async (worker, img) => (await worker.recognize(img)).data.text.trim())
}

function collectWords(data) {
  if (data.words?.length) return data.words
  const out = []
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) out.push(...l.words)
  return out
}

// Texto con posiciones (para reconstruir párrafos y tablas): { width, height, items, text, source }
export function recognizeLayouts(images, onProgress = () => {}) {
  return withWorker(images, onProgress, async (worker, img) => {
    const { data } = await worker.recognize(img, {}, { text: true, blocks: true })
    const bmp = await createImageBitmap(img)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    const items = collectWords(data)
      .filter((w) => w.text.trim() && w.confidence > 30 && !/^[|_~¦]+$/.test(w.text.trim()))
      .map((w) => ({ text: w.text, x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 }))
    return { ...size, items, text: data.text.trim(), source: 'ocr' }
  })
}
