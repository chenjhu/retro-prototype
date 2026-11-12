// Keeps a copy of the app's own files on the device so it opens without the Mac.
// Network first: when the Mac answers, the newest files are used (and cached), so
// updates still arrive. Only if it doesn't answer in time is the cached copy used.
// Data never goes through here: the app keeps its own copy of the weeks (store.js).

const CACHE = 'retro-app-v2';
const APP_FILES = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/store.js',
  '/js/items.js',
  '/js/gestures.js',
  '/js/wheel.js',
  '/shared/week.js',
  '/shared/model.js',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon-v2.png',
  '/icons/favicon-64-v2.png',
  '/icons/favicon-v2.svg',
];
const WAIT_MS = 2500; // how long to wait for the Mac before using the copy

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(networkFirst(e.request, e));
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE);
  const key = request.mode === 'navigate' ? '/' : request; // every page is the one app page
  const fromNetwork = fetch(request, { cache: 'no-store' }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  event.waitUntil(fromNetwork.catch(() => {})); // keep refreshing the copy even if we answer from it
  const timeout = new Promise((resolve) => setTimeout(resolve, WAIT_MS, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch {
    // no network: fall through to the copy
  }
  const copy = await cache.match(key, { ignoreSearch: true });
  return copy ?? fromNetwork; // nothing cached yet: wait for the network after all
}
