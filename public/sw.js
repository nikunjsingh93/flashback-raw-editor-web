// Flashback RAW Editor — Service Worker
//
// Strategy:
//   • Navigations / HTML  → network-first (so a fresh deploy is picked up the
//     next time the app is opened online; falls back to cache when offline).
//   • Content-hashed build assets (.js/.css/.wasm/.wgsl) → cache-first (their
//     names change every build, so a cached copy is always correct).
//   • LUT .cube files     → network-first, then cache (large, may be updated).
//
// Bumping CACHE_NAME changes this file's bytes, which makes the browser detect
// an updated worker, install it, and purge older caches in `activate`. Bump it
// whenever the precache list or strategy changes.
const APP_ROOT = new URL('./', self.registration.scope);
const CACHE_PREFIX = 'flashback-pages-' + encodeURIComponent(APP_ROOT.pathname) + '-';
const CACHE_NAME = CACHE_PREFIX + 'v46';

// Files to pre-cache on install (app shell).
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
].map((file) => new URL(file, APP_ROOT).href);

// ─── Install: pre-cache app shell ───────────────────────────────────────────
// NOTE: we deliberately do NOT call skipWaiting() here. A freshly installed
// worker WAITS so the running app can show an "update available" banner and let
// the user choose when to reload (rather than swapping the bundle out from under
// them mid-edit). The page posts 'skipWaiting' when the user taps Reload.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

// The page tells us to activate now (user tapped "Reload" on the update banner).
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// ─── Activate: clean up old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;

  // Navigations + HTML: network-first so redeploys aren't served stale. Falls
  // back to the cached shell when offline. We normalise the cache key to '/'
  // so the precached shell always satisfies the offline fallback.
  const isNavigation =
    request.mode === 'navigate' ||
    url.pathname === APP_ROOT.pathname ||
    url.pathname.endsWith('.html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match(APP_ROOT.href))
        )
    );
    return;
  }

  // LUT .cube files: network-first (large, may be updated), then cache.
  if (url.pathname.endsWith('.cube')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else (hashed JS/CSS/WASM/WGSL, icons, grain PNGs): cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
    )
  );
});
