/*
 * Service worker minimal untuk dapur SPPG (jaringan buruk).
 *
 * Strategi:
 * - Dokumen HTML: network-first DENGAN VALIDASI ULANG (`cache: "no-cache"`), jatuh ke cache
 *   (atau /dashboard) bila offline — supaya pengguna tetap bisa membuka layar terakhir,
 *   tetapi HTML tidak pernah basi lebih dari satu muat ulang (Pages: `max-age=600`).
 * - Aset statis (CSS/JS/ikon/gambar): STALE-WHILE-REVALIDATE — salinan cache dikirim
 *   seketika (cepat + bisa offline), sambil versi barunya diambil di latar dan disimpan.
 *   Kenapa bukan cache-first murni seperti sebelumnya: `public/` tidak ber-hash, jadi
 *   logo baru pada deploy berikutnya TIDAK PERNAH sampai ke pengguna yang sudah pernah
 *   membuka situs (terbukti 10 Okt: rail tetap menampilkan logo lama walau berkas di
 *   server sudah berganti). Dengan SWR, tampilan menyusul di pemuatan berikutnya.
 * - Chunk Next.js ber-hash (`_next/static/...`) tetap aman: URL-nya selalu baru.
 * Hanya GET ke origin sendiri yang ditangani; sisanya dibiarkan apa adanya.
 */
const CACHE = "mealchain-shell-v3";
// Base path diturunkan dari lokasi skrip ini sendiri: service worker tidak punya
// process.env, dan di GitHub Pages aplikasi disajikan di /<repo>/, bukan di akar domain.
const BASE = new URL(self.location.href).pathname.replace(/\/sw\.js$/, "");
const SHELL = [`${BASE}/dashboard/`, `${BASE}/manifest.webmanifest`, `${BASE}/icons/icon-192.png`];

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
      // `cache: "no-cache"` penting. GitHub Pages mengirim `Cache-Control: max-age=600`,
      // jadi `fetch(request)` biasa bisa mengembalikan HTML berumur sampai 10 menit — dan
      // HTML lama itu masih menunjuk URL aset TANPA hash (`/img/logo-mark.png`), sehingga
      // pengguna tetap melihat artwork lama sesudah deploy walau berkas di server sudah baru
      // (kejadian 10 Okt: "di browser belum berubah"). Dengan `no-cache`, HTML selalu
      // divalidasi ulang; Pages menjawab 304 bila isinya sama, jadi ongkosnya kecil.
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match(`${BASE}/dashboard/`))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // Stale-while-revalidate: kirim cache (kalau ada) segera, perbarui di latar belakang.
  // Aset tanpa hash (mis. /img/logo-mark.png) WAJIB lewat jalur ini supaya perubahan
  // pada deploy berikutnya sampai ke pengguna.
  event.respondWith(
    caches.match(request).then((hit) => {
      const dariJaringan = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(request, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => hit || Response.error());
      return hit || dariJaringan;
    }),
  );
});
