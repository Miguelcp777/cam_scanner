<script setup>
// Mi documento: carpetas anidadas (?path=<idCarpeta>) y documentos de la carpeta actual.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DocCard from '../components/DocCard.vue'
import { createFolder, deleteFolder, listDocs, listFolders, saveFolder } from '../lib/db'
import { useImport } from '../lib/util'

const route = useRoute()
const router = useRouter()
const { handleFiles } = useImport()
const docs = ref([])
const folders = ref([])
const input = ref(null)

const current = computed(() => route.query.path || null)
const subfolders = computed(() => folders.value.filter((f) => (f.parentId ?? null) === current.value))
const here = computed(() => docs.value.filter((d) => (d.folderId ?? null) === current.value))
const crumbs = computed(() => {
  const out = []
  let id = current.value
  while (id) {
    const f = folders.value.find((x) => x.id === id)
    if (!f) break
    out.unshift(f)
    id = f.parentId
  }
  return out
})

async function load() {
  ;[docs.value, folders.value] = await Promise.all([listDocs(), listFolders()])
}

const open = (id) => router.push({ path: '/file/manager', query: id ? { path: id } : {} })

async function newFolder() {
  const name = prompt('Nombre de la carpeta')?.trim()
  if (!name) return
  await createFolder(name, current.value)
  await load()
}

async function rename(f) {
  const name = prompt('Nuevo nombre', f.name)?.trim()
  if (!name) return
  await saveFolder({ ...f, name })
  await load()
}

async function remove(f) {
  if (!confirm(`¿Eliminar la carpeta "${f.name}"? Su contenido se moverá a la carpeta superior.`)) return
  await deleteFolder(f.id)
  await load()
}

async function onFiles(files) {
  if (!files?.length) return
  const r = await handleFiles(files, current.value)
  if (!r.images) await load()
}

watch(current, load, { immediate: true })
</script>

<template>
  <div class="row head">
    <h1>
      <a class="crumb" @click="open(null)">Mi documento</a>
      <template v-for="c in crumbs" :key="c.id"> › <a class="crumb" @click="open(c.id)">{{ c.name }}</a></template>
    </h1>
    <span class="spacer" />
    <RouterLink class="btn" to="/file/search" title="Buscar">🔍</RouterLink>
    <RouterLink class="btn" to="/file/recycler" title="Papelera">🗑</RouterLink>
    <button class="btn" @click="newFolder">📁 Nueva carpeta</button>
    <button class="btn primary" @click="input.click()">⬆ Importar</button>
    <input ref="input" type="file" accept="image/*,application/pdf" multiple hidden @change="onFiles($event.target.files)" />
  </div>

  <div v-if="subfolders.length" class="folders">
    <div v-for="f in subfolders" :key="f.id" class="folder" @click="open(f.id)">
      <span class="fico">📁</span>
      <span class="fname">{{ f.name }}</span>
      <button class="btn small" title="Renombrar" @click.stop="rename(f)">✏️</button>
      <button class="btn small danger" title="Eliminar" @click.stop="remove(f)">🗑</button>
    </div>
  </div>

  <p v-if="!here.length && !subfolders.length" class="muted">Esta carpeta está vacía.</p>
  <div class="doc-grid">
    <DocCard v-for="d in here" :key="d.id" :doc="d" />
  </div>
</template>

<style scoped>
.head { margin-bottom: 16px; }
.head h1 { margin: 0; }
.crumb { cursor: pointer; }
.crumb:hover { color: var(--accent); }
.folders { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 20px; }
.folder { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.folder:hover { border-color: var(--accent); }
.fico { font-size: 1.3rem; }
.fname { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
