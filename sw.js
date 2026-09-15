const CACHE = 'radar-caixa-brasil-pages-v4';
const BASE = new URL('./', self.location.href);
const url = (path) => new URL(path, BASE).toString();
const STATIC_ASSETS = [url('./'), url('index.html'), url('styles.css'), url('app.js'), url('manifest.webmanifest'), url('icons/icon-192.png'), url('icons/icon-512.png')];
const DATA_URL = url('data/imoveis-brasil.json');
const DB_NAME = 'radar-caixa-brasil';
const STORE = 'settings';

self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, clone)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(url('index.html')))));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
function dbGet(key, fallback) { return openDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'); const req = tx.objectStore(STORE).get(key); req.onsuccess = () => resolve(req.result ?? fallback); req.onerror = () => reject(req.error); })); }
function dbSet(key, value) { return openDb().then((db) => new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); })); }
function normalize(value='') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function yes(value) { const n = normalize(value); return n.includes('sim') || n.includes('permit') || n.includes('aceit'); }
function no(value) { return normalize(value).includes('nao'); }
function keyOf(p) { return `${p.uf || ''}:${p.numeroImovel || ''}`; }

function matchesProfile(p, f = {}) {
  if (f.state && p.uf !== f.state) return false;
  if (f.city && p.cidade !== f.city) return false;
  if (f.neighborhood && p.bairro !== f.neighborhood) return false;
  if (f.type && p.tipoImovel !== f.type) return false;
  if (f.modality && p.modalidade !== f.modality) return false;
  const checks = [
    ['minPrice','preco',(a,l)=>a>=l],['maxPrice','preco',(a,l)=>a<=l],['minDiscount','desconto',(a,l)=>a>=l],
    ['bedrooms','quartos',(a,l)=>a>=l],['bathrooms','banheiros',(a,l)=>a>=l],['parking','vagas',(a,l)=>a>=l],
    ['minArea','areaPrivativa',(a,l)=>a>=l],['maxArea','areaPrivativa',(a,l)=>a<=l],
  ];
  for (const [fk, pk, fn] of checks) { const limit = Number(f[fk] || 0); if (limit > 0 && (!Number.isFinite(p[pk]) || !fn(p[pk], limit))) return false; }
  if (f.financing === 'sim' && !yes(p.financiamento)) return false;
  if (f.financing === 'nao' && !no(p.financiamento)) return false;
  return true;
}
function profileLabel(p={}) { return p.city || p.state || p.type || 'todo o Brasil'; }

async function checkForNewProperties() {
  const response = await fetch(`${DATA_URL}?background=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) return;
  const payload = await response.json(); const properties = Array.isArray(payload.properties) ? payload.properties : [];
  const currentIds = properties.map(keyOf); const knownIds = await dbGet('knownIds', []); const alertProfile = await dbGet('alertProfile', {});
  if (!knownIds.length) { await dbSet('knownIds', currentIds); return; }
  const known = new Set(knownIds); const newItems = properties.filter((p) => !known.has(keyOf(p)) && matchesProfile(p, alertProfile)); await dbSet('knownIds', currentIds);
  if (newItems.length) await self.registration.showNotification('Novos imóveis compatíveis na CAIXA', { body: `${newItems.length} ${newItems.length === 1 ? 'novo imóvel atende' : 'novos imóveis atendem'} ao seu alerta em ${profileLabel(alertProfile)}.`, icon: url('icons/icon-192.png'), badge: url('icons/icon-192.png'), tag: 'radar-caixa-br-background', renotify: true, data: { url: BASE.toString() } });
}

self.addEventListener('periodicsync', (event) => { if (event.tag === 'check-properties') event.waitUntil(checkForNewProperties()); });
self.addEventListener('sync', (event) => { if (event.tag === 'check-properties') event.waitUntil(checkForNewProperties()); });
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SYNC_CURRENT') event.waitUntil(Promise.all([dbSet('knownIds', Array.isArray(data.ids) ? data.ids : []), dbSet('alertProfile', data.alertProfile || {})]));
  if (data.type === 'SET_ALERT_PROFILE') event.waitUntil(dbSet('alertProfile', data.alertProfile || {}));
  if (data.type === 'CHECK_NOW') event.waitUntil(checkForNewProperties());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); event.waitUntil((async () => { const list = await clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const client of list) if ('focus' in client) return client.focus(); if (clients.openWindow) return clients.openWindow(event.notification.data?.url || BASE.toString()); })());
});
