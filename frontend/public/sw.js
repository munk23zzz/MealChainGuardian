/*
 * Service worker minimal untuk dapur SPPG (jaringan buruk).
 *
 * Strategi:
 * - Dokumen HTML: network-first, jatuh ke cache (atau /dashboard) bila offline —
 *   supaya pengguna tetap bisa membuka layar terakhir.
 * - Aset statis (CSS/JS/ikon): cache-first, lalu simpan salinan.
 * Hanya GET ke origin sendiri yang ditangani; sisanya dibiarkan apa adanya.
 */
const CACHE = "mealchain-shell-v1";
const SHELL = ["/dashboard", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  const isDocument = request.headers.get("accept")?.includes("text/html");
  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match("/dashboard"))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
            return response;
          })
          .catch(() => Response.error()),
    ),
  );
});
