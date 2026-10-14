import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    // `npm run dev:phone`: HTTPS autofirmado en la red local (la cámara del iPhone exige HTTPS)
    mode === 'phone' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'DocScan',
        short_name: 'DocScan',
        description: 'Escáner de documentos, OCR y herramientas PDF en tu navegador',
        lang: 'es',
        theme_color: '#12a37f',
        background_color: '#f5f7f8',
        display: 'standalone',
        start_url: '/file/recent',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // onnx: modelo de IA de detección de bordes (4,8 MB); wasm: OpenCV y ONNX Runtime (~14 MB)
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,wasm,onnx}'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Tesseract: worker, núcleo wasm y modelos de idioma
            urlPattern: ({ url }) => ['cdn.jsdelivr.net', 'unpkg.com', 'tessdata.projectnaptha.com'].includes(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // OpenCV.js pesa ~10 MB; se carga bajo demanda solo en el escáner
    chunkSizeWarningLimit: 12000,
  },
}))
