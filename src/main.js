import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'

// Pide almacenamiento persistente: reduce el riesgo de que el navegador borre los documentos.
navigator.storage?.persist?.().catch(() => {})

createApp(App).use(router).mount('#app')
