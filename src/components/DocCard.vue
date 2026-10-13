<script setup>
import { blobUrl, formatDate } from '../lib/util'

const props = defineProps({ doc: Object, mode: { type: String, default: 'grid' } })
const thumb = () => blobUrl(props.doc.kind === 'scan' ? props.doc.pages[0]?.blob : props.doc.thumb)
</script>

<template>
  <RouterLink :to="{ path: '/file/detail', query: { id: doc.id } }" :class="['doc', mode]">
    <div class="thumb">
      <img v-if="thumb()" :src="thumb()" alt="" />
      <span v-else class="pdf">PDF</span>
      <span v-if="thumb() && doc.kind === 'pdf'" class="pdf badge">PDF</span>
    </div>
    <div class="meta">
      <div class="name" :title="doc.name">{{ doc.name }}</div>
      <div class="muted small">
        {{ formatDate(doc.updatedAt) }}<template v-if="doc.pageCount"> · {{ doc.pageCount }} pág.</template>
      </div>
      <div v-if="doc.tags?.length" class="tags">
        <span v-for="t in doc.tags.slice(0, 2)" :key="t" class="tag">🏷 {{ t }}</span>
        <span v-if="doc.tags.length > 2" class="tag">+{{ doc.tags.length - 2 }}</span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
.doc { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; display: flex; }
.doc:hover { border-color: var(--accent); }
.grid { flex-direction: column; }
.list { flex-direction: row; align-items: center; gap: 12px; padding: 6px 10px; }
.thumb { background: #eef1f3; display: grid; place-items: center; overflow: hidden; position: relative; }
.badge { position: absolute; top: 6px; right: 6px; font-size: .65rem; padding: 2px 5px; }
.list .badge { display: none; }
.grid .thumb { aspect-ratio: 3 / 4; }
.list .thumb { width: 40px; height: 52px; border-radius: 6px; flex-shrink: 0; }
.thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.pdf { background: var(--danger); color: #fff; font-weight: 700; font-size: .8rem; padding: 4px 8px; border-radius: 4px; }
.meta { padding: 8px 10px; min-width: 0; }
.list .meta { padding: 0; }
.name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.small { font-size: .8rem; }
.tags { display: flex; gap: 4px; margin-top: 4px; overflow: hidden; }
.tag { background: var(--accent-soft); color: var(--accent-dark); border-radius: 10px; padding: 1px 7px; font-size: .7rem; white-space: nowrap; }
</style>
