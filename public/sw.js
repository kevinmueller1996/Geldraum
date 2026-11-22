const VERSION = "njora-mobile-v5";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_PAGE = "/offline.html";
const PRECACHE = [
  "/",
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-512.png",
  "/njora-mark-small.webp",
  "/njora-wordmark-small.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys
      .filter((key) => key.startsWith("njora-mobile-") && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

function cacheCopy(key, response) {
  const copy = response.clone();
  return caches.open(STATIC_CACHE).then(cache => cache.put(key, copy)).catch(() => {
    // Browser storage may be full. A successful network response remains usable.
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (url.pathname === "/" && !url.search && response.ok && !response.redirected && response.headers.get("content-type")?.includes("text/html")) {
          event.waitUntil(cacheCopy("/", response));
        }
        return response;
      } catch {
        return (url.pathname === "/" && await caches.match("/")) || await caches.match(OFFLINE_PAGE);
      }
    })());
    return;
  }

  const isSafeStaticAsset = (url.pathname !== "/" && PRECACHE.includes(url.pathname))
    || url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/assets/");
  if (!isSafeStaticAsset) return;

  event.respondWith((async () => {
    const cached = await caches.match(request).catch(() => undefined);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.redirected) event.waitUntil(cacheCopy(request, response));
    return response;
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "NJORA_WARM_SHELL" && Array.isArray(event.data.assets)) {
    event.waitUntil((async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(event.data.assets.map(value => new URL(value, self.location.origin)).filter(url =>
        url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/assets/")))
        .map(async url => { if (!await cache.match(url.href)) await cache.add(url.href); }));
    })());
  }
  if (event.data === "NJORA_VERSION") event.source?.postMessage(VERSION);
});
