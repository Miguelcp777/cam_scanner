import { createRouter, createWebHistory } from 'vue-router'

// Rutas alineadas con las observadas en el análisis REA (docs/analisis-rea.md)
const routes = [
  { path: '/', redirect: '/file/recent' },
  { path: '/file/recent', component: () => import('./views/HomeView.vue') },
  { path: '/file/manager', component: () => import('./views/ManagerView.vue') },
  { path: '/file/detail', component: () => import('./views/DetailView.vue') },
  { path: '/scanner', component: () => import('./views/ScannerView.vue') },
  { path: '/tools/main', component: () => import('./views/ToolsView.vue') },
  { path: '/tools/mergepdf', component: () => import('./views/MergeView.vue') },
  { path: '/tools/extractpdfpages', component: () => import('./views/ExtractView.vue') },
  { path: '/tools/webocr', component: () => import('./views/OcrView.vue') },
  { path: '/tools/pdftoword', component: () => import('./views/ConvertView.vue'), meta: { to: 'word' } },
  { path: '/tools/pdftoexcel', component: () => import('./views/ConvertView.vue'), meta: { to: 'excel' } },
  { path: '/tools/pdftoppt', component: () => import('./views/ConvertView.vue'), meta: { to: 'ppt' } },
  { path: '/tools/pdftopic', component: () => import('./views/ConvertView.vue'), meta: { to: 'image' } },
  { path: '/sign/home', component: () => import('./views/SignHomeView.vue') },
  { path: '/sign/detail', component: () => import('./views/SignDetailView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/file/recent' },
]

export default createRouter({ history: createWebHistory(), routes })
