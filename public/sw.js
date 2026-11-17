/* Offline support: the lookup works with no network after the first visit. */
var CACHE = 'ushers-v4';
var OCR_VERSION = 'ocr-tess7.0.0-core7.0.0-eng1.0.0'; // bump when /ocr files change
var OCR_CACHE = 'ushers-' + OCR_VERSION;
var OCR_FILES = ['/ocr/t7.0.0/tesseract.min.js', '/ocr/t7.0.0/worker.min.js', '/ocr/t7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js', '/ocr/t7.0.0/tesseract-core-simd-lstm.wasm.js', '/ocr/t7.0.0/tesseract-core-lstm.wasm.js', '/ocr/t7.0.0/lang/eng.traineddata.gz'];
var SHELL = ['/', '/css/base.css', '/css/app.css', '/js/lookup.js', '/js/ocr-parse.js', '/js/ocr-preprocess.js', '/js/ar-digits.js', '/js/ar-digits-model.json', '/js/scanner.js', '/js/app.js', '/data/committees.json', '/img/team.png', '/img/list-logo.png', '/img/club-emblem.png',
  '/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2', '/fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2',
  '/fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2', '/fonts/ibm-plex-sans-arabic-latin-600-normal.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(Promise.all([caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }),
    caches.open(OCR_CACHE).then(function (c) { return c.addAll(OCR_FILES); })]).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== OCR_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return; // the page handles API caching itself (localStorage)
  // OCR assets: versioned, immutable -> cache first
  if (url.pathname.indexOf('/ocr/') === 0) {
    e.respondWith(caches.open(OCR_CACHE).then(function (c) {
      return c.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }); });
    }));
    return;
  }
  // stale-while-revalidate for the app shell
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
