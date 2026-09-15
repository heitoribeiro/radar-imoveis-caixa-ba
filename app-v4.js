// Bootstrap robusto do mapa. Carrega Leaflet com múltiplos fallbacks antes de iniciar o app.
const MAP_STATUS = () => document.querySelector('#mapStatus');

function addLeafletCss() {
  if (document.querySelector('link[data-radar-leaflet-fallback]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
  link.dataset.radarLeafletFallback = '1';
  link.onerror = () => {
    link.onerror = null;
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
  };
  document.head.appendChild(link);
}

function loadScript(url, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      s.remove();
      reject(new Error(`Timeout carregando ${url}`));
    }, timeoutMs);
    s.src = url;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.remove();
      reject(new Error(`Falha carregando ${url}`));
    };
    document.head.appendChild(s);
  });
}

async function ensureLeaflet() {
  addLeafletCss();
  if (window.L) return true;
  const status = MAP_STATUS();
  if (status) status.textContent = 'Carregando mapa…';
  const urls = [
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  ];
  for (const url of urls) {
    try {
      await loadScript(url);
      if (window.L) return true;
    } catch (e) {
      console.warn('[Radar CAIXA] CDN do mapa indisponível:', e.message);
    }
  }
  return false;
}

function hardenTileLayer() {
  if (!window.L || window.L.__radarTilePatch) return;
  const original = window.L.tileLayer;
  window.L.tileLayer = function(url, options) {
    // Evita dependência dos subdomínios a/b/c, que falham em algumas redes móveis/DNS.
    if (typeof url === 'string' && url.includes('{s}.tile.openstreetmap.org')) {
      url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
    const layer = original.call(this, url, options);
    let errors = 0;
    layer.on('tileerror', () => {
      errors += 1;
      if (errors === 4) {
        const status = MAP_STATUS();
        if (status) status.textContent = 'Mapa carregado, mas a rede está bloqueando algumas imagens cartográficas. Tentando novamente…';
      }
    });
    return layer;
  };
  window.L.__radarTilePatch = true;
}

(async () => {
  const ok = await ensureLeaflet();
  if (!ok) {
    const status = MAP_STATUS();
    if (status) status.textContent = 'Não foi possível carregar a biblioteca do mapa nesta rede. Recarregue a página ou tente outra conexão.';
    console.error('[Radar CAIXA] Leaflet não pôde ser carregado por nenhum CDN.');
    // O restante do aplicativo deve continuar funcionando mesmo sem o mapa.
  } else {
    hardenTileLayer();
  }
  try {
    await import('./app-core.js?mapfix=20260915-2');
  } catch (e) {
    console.error('[Radar CAIXA] Falha ao iniciar aplicação:', e);
    const status = MAP_STATUS();
    if (status && ok) status.textContent = 'O mapa foi carregado, mas ocorreu uma falha ao iniciar os dados. Recarregue a página.';
  }
})();
