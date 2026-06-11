// AgroMap Chile — Service Worker v3.0
// Offline-first robusto para agricultores sin señal
const CACHE_NAME = 'agromap-v3';

// Assets críticos para funcionar offline (se cachean en el install)
const CRITICAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js',
];

// Assets secundarios (fuentes, tiles — se cachean con fetch)
const SECONDARY_PATTERNS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', e => {
  console.log('[SW] Instalando y cacheando assets críticos...');
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cachear assets críticos (Leaflet) al instalar
      return Promise.allSettled(
        CRITICAL_ASSETS.map(url =>
          fetch(url).then(r => {
            if (r.ok) return cache.put(url, r);
          }).catch(() => console.warn('[SW] No se pudo pre-cachear:', url))
        )
      );
    }).then(() => {
      console.log('[SW] Assets críticos cacheados');
      return self.skipWaiting();
    })
  );
});

const KEEP_CACHES = [CACHE_NAME, 'agromap-tiles-v1'];

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP_CACHES.includes(k)).map(k => {
          console.log('[SW] Eliminando cache viejo:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isAPI = /open-meteo\.com|isric\.org|odepa\.gob\.cl/.test(url);
  const isFonts = /fonts\.(googleapis|gstatic)\.com/.test(url);
  const isTile = /arcgisonline\.com|arcgis\.com/.test(url);
  const isCDN = /cdnjs\.cloudflare\.com/.test(url);

  if (isCDN || isFonts) {
    // Cache-first para CDN y fuentes — crítico para offline
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) {
          // Actualizar en background si hay red
          fetch(e.request).then(r => {
            if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, r));
          }).catch(() => {});
          return cached;
        }
        return fetch(e.request).then(r => {
          if (r && r.ok) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return r;
        }).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
      })
    );
  } else if (isAPI) {
    // Network-first para APIs de datos — cache como respaldo offline
    e.respondWith(
      fetch(e.request.clone(), { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined })
        .then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => {
          console.log('[SW] Sin red, usando cache para:', url.substring(0, 60));
          return caches.match(e.request).then(c => c || new Response(
            JSON.stringify({ error: 'offline', cached: false }),
            { headers: { 'Content-Type': 'application/json' } }
          ));
        })
    );
  } else if (isTile) {
    // Cache-first para tiles — busca en AMBOS caches (principal y tiles)
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        // Buscar también en el cache de tiles
        return caches.open('agromap-tiles-v1').then(tileCache =>
          tileCache.match(e.request)
        ).then(tileCached => {
          if (tileCached) return tileCached;
          // No está en ningún cache — intentar red
          return fetch(e.request).then(r => {
            if (r && r.ok) {
              // Guardar en cache de tiles
              caches.open('agromap-tiles-v1').then(c => c.put(e.request, r.clone()));
            }
            return r;
          }).catch(() => new Response('', { status: 503, statusText: 'Tile no disponible offline' }));
        });
      })
    );
  }
  // El HTML principal no lo interceptamos — siempre desde red o cache del browser
});
