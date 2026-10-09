const CACHE_NAME = 'papiro-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/base.css',
  './css/layout.css',
  './css/editor.css',
  './css/print.css',
  './css/sheets.css',
  './js/app.js',
  './js/core/util.js',
  './js/core/state.js',
  './js/core/store.js',
  './js/core/idb.js',
  './js/core/formats.js',
  './js/core/docx.js',
  './js/core/odt.js',
  './js/core/zip.js',
  './js/core/sanitize.js',
  './js/core/editor.js',
  './js/core/shortcuts.js',
  './js/components/dialogs.js',
  './js/components/toast.js',
  './js/components/findbar.js',
  './js/components/imageTools.js',
  './js/components/sidebar.js',
  './js/components/statusbar.js',
  './js/components/fileMenu.js',
  './js/components/personalization.js',
  './js/pages/files.js',
  './js/pages/history.js',
  './js/apps/sheets.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== CACHE_NAME)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});