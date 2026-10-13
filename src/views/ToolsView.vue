<script setup>
const groups = [
  {
    title: 'Escanear',
    tools: [
      { to: '/scanner?camera=1', ico: '📷', label: 'Escanear' },
      { to: '/scanner', ico: '🖼️', label: 'Imágenes a PDF' },
      { to: '/tools/webocr', ico: '🔤', label: 'Imagen a texto (OCR)' },
    ],
  },
  {
    title: 'Convertir',
    tools: [
      { to: '/tools/pdftoword', ico: '📝', label: 'PDF a Word' },
      { to: '/tools/pdftoexcel', ico: '📊', label: 'PDF a Excel' },
      { to: '/tools/pdftoppt', ico: '📽️', label: 'PDF a PPT' },
      { to: '/tools/pdftopic', ico: '🖼️', label: 'PDF a imagen' },
    ],
  },
  {
    title: 'Editar PDF',
    tools: [
      { to: '/tools/mergepdf', ico: '🧩', label: 'Combinar archivos' },
      { to: '/tools/extractpdfpages', ico: '✂️', label: 'Extraer páginas' },
      { to: '/sign/home', ico: '✍️', label: 'Firma electrónica' },
    ],
  },
  {
    title: 'Próximamente',
    soon: true,
    tools: [{ ico: '🤖', label: 'Asistente de IA' }],
  },
]
</script>

<template>
  <h1>Herramientas</h1>
  <section v-for="g in groups" :key="g.title" class="group">
    <h2>{{ g.title }}</h2>
    <div class="tool-grid">
      <component :is="g.soon ? 'div' : 'RouterLink'" v-for="t in g.tools" :key="t.label" :to="t.to" :class="['tool', { soon: g.soon }]">
        <span class="ico">{{ t.ico }}</span>{{ t.label }}
      </component>
    </div>
  </section>
</template>

<style scoped>
.group { margin-bottom: 24px; }
.group h2 { margin-bottom: 10px; }
.soon { opacity: .45; cursor: default; }
.soon:hover { background: none; }
</style>
