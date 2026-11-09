const VERSION = "njora-mobile-v3";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_PAGE = "/offline.html";
const PRECACHE = [
  OFFLINE_PAGE,
  "/manifest.webmanifest",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-512.png",
  "/njora-mark.png",
  "/njora-wordmark.png",
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)));
    return;
  }

  const isSafeStaticAsset = PRECACHE.includes(url.pathname)
    || url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/assets/");
  if (!isSafeStaticAsset) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});

self.addEventListener("message", (event) => {
  if (event.data === "NJORA_VERSION") event.source?.postMessage(VERSION);
});
