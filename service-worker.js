const CACHE_NAME = 'competitiva-ja-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first para las llamadas a la API (datos siempre frescos),
// cache-first para el resto (app shell), para poder abrir la app offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isApi = url.origin !== self.location.origin;

  if (isApi) {
    event.respondWith(fetch(event.request).catch(() => new Response(
      JSON.stringify({ ok: false, error: 'Sin conexión' }),
      { headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
