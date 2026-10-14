# DocScan

Escáner de documentos web inspirado en el flujo de uso de CamScanner Web.
Código propio: no reutiliza código ni marca de CamScanner. Todo se procesa y guarda **en el dispositivo**;
ningún documento se sube a un servidor.

## Arrancar

```bash
npm install
npm run dev          # http://localhost:5173 (ordenador)
npm run dev:phone    # https://<IP-del-PC>:5173 (probar desde el iPhone en la misma Wi-Fi)
```

`dev:phone` usa un certificado autofirmado: Safari mostrará un aviso ("Esta conexión no es privada" →
Mostrar detalles → visitar este sitio web). La cámara funciona, pero **la instalación como app (PWA) y el
modo sin conexión requieren HTTPS real**, es decir, publicar la app (Cloudflare Pages, Netlify, GitHub Pages…).

## Funciones

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Inicio | `/file/recent` | Arrastrar y soltar, escanear (cámara nativa en móvil), importar, recientes |
| Mi documento | `/file/manager?path=<carpeta>` | Carpetas anidadas |
| Escáner | `/scanner` | Foto → bordes → perspectiva → filtros → varias páginas |
| Documento | `/file/detail?id=<doc>` | Páginas, exportar/compartir PDF, OCR (también de PDFs), convertir, firmar |
| Convertir | `/tools/pdftoword`, `pdftoexcel`, `pdftoppt`, `pdftopic` | Word (párrafos y títulos), Excel (columnas de tablas), PPT (diapositiva por página), JPG |
| Firma | `/sign/home`, `/sign/detail?id=<doc>` | Dibujar firmas, colocarlas/moverlas/redimensionarlas, genera copia "(firmado)" |
| Herramientas | `/tools/main`, `/tools/mergepdf`, `/tools/extractpdfpages`, `/tools/webocr` | Combinar, extraer páginas, imagen a texto |

## iPhone

- **Instalar**: Safari → Compartir → *Añadir a pantalla de inicio*. Sin instalar, Safari puede borrar los datos
  de webs no visitadas en 7 días.
- **Cámara**: cámara dentro de la app con detección de bordes en vivo y foto automática al quedarse quieta
  (`createLiveDetector` en `scan.js`). La cámara del sistema queda como alternativa (sin detección en vivo).
- **Exportar**: botón *Compartir / Guardar* (hoja del sistema: Fotos, Archivos, WhatsApp…). Aparece tras generar
  el archivo porque Safari exige un toque reciente del usuario.
- **Memoria**: fotos reducidas a 3000 px y canvas liberados tras cada página (límite de memoria de canvas en iOS).

## Arquitectura

| Archivo | Responsabilidad | Librería |
|---|---|---|
| `src/lib/db.js` | Documentos, carpetas y firmas en IndexedDB | `idb` |
| `src/lib/scan.js` | Bordes, perspectiva, filtros, gestión de memoria | OpenCV.js (bajo demanda) |
| `src/lib/opencv-loader.js` | Carga segura de OpenCV (evita el bucle del thenable de Emscripten) | — |
| `src/lib/render.js` | Renderizar páginas PDF y miniaturas | `pdfjs-dist` |
| `src/lib/pages.js` | Imágenes y texto posicionado de cualquier documento (capa de texto o OCR) | — |
| `src/lib/layout.js` | Reconstruir filas, párrafos, títulos y tablas | — |
| `src/lib/convert.js` | Word / Excel / PPT / JPG | `docx`, `exceljs`, `pptxgenjs` |
| `src/lib/pdf.js` | Generar, combinar, extraer, estampar firmas | `pdf-lib` |
| `src/lib/ocr.js` | OCR español + inglés (texto y posiciones) | `tesseract.js` (modelos desde CDN, cacheados) |
| `src/lib/share.js` | Web Share API con respaldo a descarga | — |

## Escáner: cómo procesa cada foto

1. Detección del papel con IA: modelo [DocAligner](https://github.com/DocsaidLab/DocAligner) LCNet100 (DocsaidLab,
   Apache-2.0, `public/models/`), ejecutado en el dispositivo con ONNX Runtime Web (`src/lib/aiDetect.js`). Si la IA
   no está segura, se usa el método clásico (`findQuad`). En ambos casos se afina cada lado con rectas robustas
   (`refineQuad`). Se puede elegir el motor en Ajustes.
2. Ajuste final al papel exacto (`snapToPaper`) y proporción real con corrección de perspectiva.
3. Aplanado de papel curvado (`flattenDocument`): bordes curvos → parche de Coons; después, con los fragmentos de texto
   (palabras, columnas de tique, separadores) se calcula una base suave de inclinación y una corrección por renglón, que
   endereza también esquinas levantadas y dobleces locales.
4. Filtro *Documento*: iluminación uniforme, restos de fondo en los bordes eliminados, niveles adaptativos.
5. Recorte manual con lupa 4× al arrastrar una esquina.

Banco de pruebas con fotos sintéticas: `src/dev/scanBench.js` (`runBench`, `runWarpBench`, `runFlattenBench`,
`runAiBench` — compara IA y método clásico, incluidos fondos difíciles: mesa blanca, otros papeles, manteles).

Por qué IA: el análisis REA de CamScanner Web (`docs/`, no publicado) muestra que su recorte automático no se hace en
el navegador sino en su servidor (`/image/image_handle/auto_cut`) o en un módulo nativo de su app de escritorio.
DocScan no usa su servicio: reproduce la técnica (red neuronal de detección de esquinas) con un modelo abierto.

## Limitaciones conocidas

- Conversiones heurísticas: no conservan fuentes, colores ni imágenes incrustadas (Word/Excel); PPT usa la página como imagen.
- Firma: no contempla páginas PDF rotadas ni con CropBox distinto de MediaBox. Es una firma visual, no una firma digital certificada.
- Primera carga de la app instalada: ~14 MB en caché (OpenCV, pdf.js, conversores) para funcionar sin conexión.

## Pendiente

Asistente de IA, cuentas y sincronización en la nube.
