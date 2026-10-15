/* Bizzle X-Ray v4.20 service worker. CACHE changes on every build (scripts/bump-version.sh) so old caches are busted. */
var CACHE = 'bizzle-xray-2026-10-15.1';
var SHELL = ['./', 'index.html', 'launch.html', 'css/app.css?v=2026-10-15.1', 'js/config.js?v=2026-10-15.1', 'js/ai.js?v=2026-10-15.1', 'js/scan.js?v=2026-10-15.1',
  'js/brain.js?v=2026-10-15.1', 'js/app.js?v=2026-10-15.1', 'vendor/jszip.min.js?v=3.10.2', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('bizzle-xray-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // readers + AI calls always go to the network
  if (req.mode === 'navigate') {   // network-first for pages so new builds show up immediately
    e.respondWith(fetch(req).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(url.pathname.indexOf('launch') >= 0 ? 'launch.html' : 'index.html', cp); }); return r; })
      .catch(function () { return caches.match(url.pathname.indexOf('launch') >= 0 ? 'launch.html' : 'index.html'); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) { if (r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); } return r; });
  }));
});
