// Działa też bez internetu (siłownia w piwnicy): najpierw sieć, a gdy jej nie ma, ostatnia zapisana wersja.
const CACHE = 'trening-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const kopia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || Response.error())),
  );
});
