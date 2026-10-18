/* Offline-first service worker. Caches the app shell only; never contacts other origins.
   Shell URLs are resolved against this script's directory, so a project-page
   subpath such as /LSV-Fuel-App/ is cached and controlled, not the host root. */
var CACHE = 'lsv-fuel-v1.0.0';
var BASE = new URL('./', self.location);
function appUrl(path) { return new URL(path, BASE).href; }
var SHELL = ['', 'index.html', 'styles.css', 'calc.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'].map(appUrl);
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(appUrl('index.html')).then(function (r) { return r || fetch(req); }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (r) {
    return r || fetch(req).then(function (resp) {
      if (resp && resp.ok && resp.type === 'basic') { var cp = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return resp;
    });
  }));
});
