<script setup>
// Papelera (/file/recycler): los documentos eliminados se conservan TRASH_DAYS días
import { onMounted, ref } from 'vue'
import { emptyTrash, listTrash, purgeDoc, restoreDoc, TRASH_DAYS } from '../lib/db'
import { blobUrl, formatDate } from '../lib/util'

const docs = ref([])
const load = async () => (docs.value = await listTrash())

const daysLeft = (d) => Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - d.deletedAt) / 86400000))
const thumb = (d) => blobUrl(d.kind === 'scan' ? d.pages[0]?.blob : d.thumb)

async function restore(d) {
  await restoreDoc(d.id)
  await load()
}

async function purge(d) {
  if (!confirm(`¿Eliminar "${d.name}" definitivamente? No se puede deshacer.`)) return
  await purgeDoc(d.id)
  await load()
}

async function empty() {
  if (!confirm(`¿Vaciar la papelera? Se eliminarán ${docs.value.length} documento(s) definitivamente.`)) return
  await emptyTrash()
  await load()
}

onMounted(load)
</script>

<template>
  <div class="row head">
    <h1>🗑 Papelera</h1>
    <span class="spacer" />
    <button v-if="docs.length" class="btn danger" @click="empty">Vaciar papelera</button>
  </div>
  <p class="muted">Los documentos eliminados se guardan aquí {{ TRASH_DAYS }} días; después se borran definitivamente.</p>
  <p v-if="!docs.length" class="muted empty">La papelera está vacía.</p>
  <div class="list">
    <div v-for="d in docs" :key="d.id" class="item">
      <div class="thumb">
        <img v-if="thumb(d)" :src="thumb(d)" alt="" />
        <span v-else class="pdf">PDF</span>
      </div>
      <div class="meta">
        <div class="name">{{ d.name }}</div>
        <div class="muted small">Eliminado {{ formatDate(d.deletedAt) }} · se borra en {{ daysLeft(d) }} día(s)</div>
      </div>
      <button class="btn small" @click="restore(d)">↩ Restaurar</button>
      <button class="btn small danger" title="Eliminar definitivamente" @click="purge(d)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.head { margin-bottom: 8px; }
.head h1 { margin: 0; }
.empty { text-align: center; padding: 30px; }
.list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.item { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
.thumb { width: 40px; height: 52px; border-radius: 6px; overflow: hidden; background: #eef1f3; display: grid; place-items: center; flex-shrink: 0; }
.thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; opacity: .7; }
.pdf { background: var(--danger); color: #fff; font-weight: 700; font-size: .65rem; padding: 2px 5px; border-radius: 4px; }
.meta { flex: 1; min-width: 0; }
.name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.small { font-size: .8rem; }
</style>
