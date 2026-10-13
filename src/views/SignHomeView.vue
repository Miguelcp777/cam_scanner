<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DocPicker from '../components/DocPicker.vue'
import SignaturePad from '../components/SignaturePad.vue'
import { deleteSignature, listSignatures, saveSignature } from '../lib/db'
import { blobUrl } from '../lib/util'

const router = useRouter()
const sigs = ref([])
const drawing = ref(false)
const selected = ref([])

const load = async () => (sigs.value = await listSignatures())

async function onSave(sig) {
  await saveSignature(sig)
  drawing.value = false
  await load()
}

async function remove(s) {
  if (!confirm('¿Eliminar esta firma?')) return
  await deleteSignature(s.id)
  await load()
}

onMounted(load)
</script>

<template>
  <h1>✍️ Firma electrónica</h1>

  <section class="card block">
    <div class="row">
      <h2>Mis firmas</h2>
      <span class="spacer" />
      <button v-if="!drawing" class="btn" @click="drawing = true">➕ Nueva firma</button>
    </div>
    <SignaturePad v-if="drawing" @save="onSave" @cancel="drawing = false" />
    <p v-else-if="!sigs.length" class="muted">Aún no tienes firmas. Crea una para empezar.</p>
    <div class="sigs">
      <div v-for="s in sigs" :key="s.id" class="sig">
        <img :src="blobUrl(s.blob)" alt="Firma" />
        <button class="btn small danger" title="Eliminar" @click="remove(s)">🗑</button>
      </div>
    </div>
  </section>

  <section class="card block">
    <h2>Documento a firmar</h2>
    <DocPicker v-model="selected" />
    <div class="row">
      <button
        class="btn primary"
        :disabled="!selected.length || !sigs.length"
        @click="router.push({ path: '/sign/detail', query: { id: selected[0] } })"
      >
        ✍️ Firmar documento
      </button>
      <span v-if="selected.length && !sigs.length" class="muted">Primero crea una firma.</span>
    </div>
  </section>
</template>

<style scoped>
.block { margin-bottom: 16px; display: flex; flex-direction: column; gap: 12px; }
.sigs { display: flex; flex-wrap: wrap; gap: 10px; }
.sig { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 10px; padding: 6px 10px; background: #fff; }
.sig img { height: 50px; max-width: 200px; object-fit: contain; }
</style>
