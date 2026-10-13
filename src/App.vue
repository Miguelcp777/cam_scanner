<script setup>
const nav = [
  { to: '/tools/main', label: 'Herramientas', icon: '🧰' },
  { to: '/file/recent', label: 'Inicio', icon: '🏠' },
  { to: '/file/manager', label: 'Mi documento', icon: '📁' },
  { to: '/sign/home', label: 'Firmar', icon: '✍️' },
]
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <RouterLink to="/file/recent" class="brand"><span class="logo">DS</span> DocScan</RouterLink>
      <nav>
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="nav-item">
          <span>{{ n.icon }}</span>{{ n.label }}
        </RouterLink>
      </nav>
      <p class="sidebar-note">Tus documentos se guardan solo en este navegador.</p>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
