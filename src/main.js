import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'
import { purgeOldTrash } from './lib/db'

// Pide almacenamiento persistente: reduce el riesgo de que el navegador borre los documentos.
navigator.storage?.persist?.().catch(() => {})
// Borra definitivamente lo que lleva más de 30 días en la papelera
purgeOldTrash().catch(() => {})

createApp(App).use(router).mount('#app')
