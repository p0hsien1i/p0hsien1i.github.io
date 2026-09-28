// Brian as the Chef service worker：網路優先（每次都向伺服器確認有沒有新版），離線時用快取。
// 每次改版都要把 CACHE 版本號加 1，App 才會偵測到新版並自動重新載入。
const CACHE = 'fanfit-v15';
const ASSETS = ['./', 'index.html', 'app.css', 'app.js', 'foods.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  // cache: 'reload'：略過手機的 HTTP 暫存，確保存進來的是伺服器上最新的檔案
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // cache: 'no-cache'：每次都向伺服器確認（沒變只回 304，幾乎不耗流量），
    // 避免 GitHub Pages 的 10 分鐘暫存讓手機一直拿到舊版
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
