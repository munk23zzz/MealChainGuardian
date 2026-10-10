/**
 * Harness regresi brand: aset brand HARUS kebal cache.
 *
 * Latar belakang (10 Okt 2026): logo baru sudah benar di server, tetapi pengguna tetap
 * melihat artwork lama karena URL aset di `public/` tidak ber-hash (cache HTTP 10 menit +
 * cache service worker). Harness ini mengunci perbaikannya supaya tidak mundur lagi kalau
 * seseorang memasang mark lewat string URL lagi, atau favicon tanpa query versi.
 *
 * Yang diperiksa pada halaman nyata (profil Chrome lewat CDP):
 *   1. TEPAT SATU `<link rel="icon">` dan href-nya ber-versi (`?v=`).
 *   2. Setiap `<img>` yang memuat mark memakai URL ber-hash `_next/static/media/logo-mark.<hash>.png`
 *      (bukan `/img/logo-mark.png`).
 *   3. Berkas yang benar-benar diunduh = berkas di `frontend/assets/logo-mark.png` (dibandingkan bytes).
 *   4. Kontrol negatif: URL lama `/img/logo-mark.png` menjawab 404.
 *
 * Pakai:
 *   node scripts/verify-brand-assets.mjs                     # pratinjau lokal (default :4174)
 *   node scripts/verify-brand-assets.mjs https://munk23zzz.github.io/MealChainGuardian
 *   CDP_URL=http://127.0.0.1:9333 node scripts/verify-brand-assets.mjs
 * Keluar dengan kode 1 bila ada pemeriksaan yang gagal.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:4174/MealChainGuardian").replace(/\/$/, "");
const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = join(FRONTEND, "assets", "logo-mark.png");
const markBytes = readFileSync(MARK);
const markHash = createHash("sha256").update(markBytes).digest("hex").slice(0, 12);
const markSha = createHash("sha1").update(markBytes).digest("base64");

const hasil = [];
const periksa = (nama, lulus, detail) => {
  hasil.push({ nama, lulus, detail });
  console.log(`${lulus ? "  OK  " : " GAGAL"}  ${nama}${detail ? ` — ${detail}` : ""}`);
};

async function sesi() {
  const daftar = await (await fetch(`${CDP}/json/list`)).json();
  const target = daftar.find((t) => t.type === "page");
  if (!target) throw new Error("tidak ada tab di CDP");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const tunggu = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && tunggu.has(m.id)) {
      tunggu.get(m.id)(m);
      tunggu.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      tunggu.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const nilai = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${BASE}/login/?periksa=${Date.now()}` });
  await sleep(6000);
  return { ws, nilai, send };
}

/** Ambil keterangan semua <img> yang menampilkan mark, beserta bytes dan sha-nya. */
const SKRIP_MARK = `(async () => {
  const kandidat = [...document.images].filter((i) => (i.currentSrc || i.src).includes('logo-mark'));
  const data = [];
  for (const i of kandidat) {
    const url = i.currentSrc || i.src;
    const r = await fetch(url, { cache: 'no-store' });
    const buf = new Uint8Array(await r.arrayBuffer());
    const h = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
    data.push({
      url,
      status: r.status,
      bytes: buf.byteLength,
      sha1: btoa([...h].map((b) => String.fromCharCode(b)).join('')),
      natural: i.naturalWidth + 'x' + i.naturalHeight,
      rendered: i.width + 'x' + i.height,
      latar: getComputedStyle(i.parentElement).backgroundColor,
    });
  }
  return {
    ikon: [...document.querySelectorAll('link[rel*=icon]')].map((l) => l.getAttribute('href')),
    mark: data,
  };
})()`;

const { ws, nilai } = await sesi();
let laporan;
try {
  laporan = await nilai(SKRIP_MARK);
} finally {
  ws.close();
}

console.log(`\nSasaran: ${BASE}\n`);

// 1. favicon: tepat satu, ber-versi
periksa(
  "tepat satu <link rel=icon> dan ber-versi",
  laporan.ikon.length === 1 && /\?v=\d+/.test(laporan.ikon[0]),
  laporan.ikon.join(", ") || "(tidak ada)",
);

// 2. mark memakai URL ber-hash
periksa("mark ditemukan di halaman", laporan.mark.length > 0, `${laporan.mark.length} elemen`);
periksa(
  "semua mark memakai URL ber-hash _next/static/media/",
  laporan.mark.length > 0 && laporan.mark.every((m) => /\/_next\/static\/media\/logo-mark\.[0-9a-f]+\.png$/.test(m.url)),
  laporan.mark.map((m) => m.url.replace(BASE, "")).join(" | "),
);

// 3. berkas yang diunduh = berkas di repo
periksa(
  "berkas mark identik dengan frontend/assets/logo-mark.png",
  laporan.mark.length > 0 && laporan.mark.every((m) => m.status === 200 && m.sha1 === markSha),
  laporan.mark.map((m) => `${m.status} ${m.bytes} B sha1 ${m.sha1.slice(0, 12)}`).join(" | ") +
    ` (repo: ${markBytes.byteLength} B sha1 ${markHash.slice(0, 12)})`,
);
periksa(
  "mark benar-benar ter-render (natural 96x96, termuat)",
  laporan.mark.length > 0 && laporan.mark.every((m) => m.natural === "96x96"),
  laporan.mark.map((m) => `natural ${m.natural} render ${m.rendered} latar ${m.latar}`).join(" | "),
);

// 4. kontrol negatif: URL lama sudah tidak dilayani — diperiksa dari sisi SERVER (node), bukan
//    dari halaman: service worker boleh masih menyajikan salinan lamanya untuk kebutuhan offline.
const lama = await fetch(`${BASE}/img/logo-mark.png`, { redirect: "manual" });
periksa("kontrol negatif (server): /img/logo-mark.png sudah tidak dilayani", lama.status === 404, `status ${lama.status}`);

// 5. favicon: berkas yang disajikan = berkas di repo (favicon punya URL ber-versi, jadi
//    permintaan di sini memakai href yang benar-benar dipasang halaman).
const FAVICON = join(FRONTEND, "public", "favicon.ico");
const favBytes = readFileSync(FAVICON);
const favSha = createHash("sha1").update(favBytes).digest("base64");
const ikonHref = laporan.ikon[0] ?? ""; // mis. "/MealChainGuardian/favicon.ico?v=3"
const favUrl = new URL(ikonHref, `${BASE}/`).href;
const favRes = await fetch(favUrl, { cache: "no-store" });
const favDapat = new Uint8Array(await favRes.arrayBuffer());
const favSha1 = createHash("sha1").update(favDapat).digest("base64");
periksa(
  "favicon yang disajikan identik dengan public/favicon.ico",
  favRes.status === 200 && favSha1 === favSha,
  `${favRes.status} · ${favDapat.byteLength} B · sha1 ${favSha1.slice(0, 12)} (repo: ${favBytes.byteLength} B sha1 ${favSha.slice(0, 12)})`,
);

const favIco = (() => {
  // jumlah entri + ukurannya, tanpa asumsi urutan: baca direktori ICO
  const jumlah = favDapat[4] | (favDapat[5] << 8);
  const ukuran = [];
  for (let i = 0; i < jumlah; i += 1) {
    const o = 6 + i * 16;
    ukuran.push(favDapat[o] === 0 ? 256 : favDapat[o]);
  }
  return ukuran;
})();
periksa("favicon memuat entri 16/32/48/256", JSON.stringify(favIco) === JSON.stringify([16, 32, 48, 256]), `entri ${favIco.join("/")}`);

const gagal = hasil.filter((h) => !h.lulus);
console.log(
  gagal.length === 0
    ? `\nHASIL: LULUS — ${hasil.length}/${hasil.length} pemeriksaan`
    : `\nHASIL: GAGAL — ${gagal.length} dari ${hasil.length} pemeriksaan tidak lulus`,
);
process.exit(gagal.length === 0 ? 0 : 1);
