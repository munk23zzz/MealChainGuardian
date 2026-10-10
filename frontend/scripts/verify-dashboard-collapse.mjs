/**
 * Penjaga regresi untuk bug React #185 ("Maximum update depth exceeded") di /dashboard/.
 *
 * Kenapa ada: menutup rail sidebar dulu mematikan seluruh halaman dashboard. Rail bertransisi
 * lebar 300ms, dan tiap frame mengubah lebar wadah chart → `ResponsiveContainer` tanpa throttle
 * menjalankan setState + siklus store Recharts per frame, hingga React menembus batas update
 * bersarang. Perbaikannya `debounce={150}` di `components/charts/*`. Skrip ini adalah cara
 * membuktikan perbaikan itu masih berlaku — bukan sekadar "kelihatannya jalan".
 *
 * Kenapa MutationObserver: tanpa observer, crash-nya cuma ~3 dari 4 percobaan (kadang hijau),
 * jadi "halaman hidup" saja tidak cukup sebagai bukti. Dengan observer terpasang, hasilnya
 * konsisten, dan jumlah mutasi atribut menjadi angka yang bisa dibandingkan:
 *   sebelum perbaikan: attr ≈ 686, halaman MATI
 *   sesudah perbaikan: attr ≈ 76,  halaman hidup
 * Ambangnya sengaja longgar (200) supaya tidak rapuh terhadap perbedaan kecil tata letak.
 *
 * Prasyarat (dua-duanya dijalankan sendiri, lihat skill frontend):
 *   1. hasil ekspor disajikan di sub-path, mis.
 *      python -m http.server 4174 --directory <scratch>/site-preview
 *      (isi: out/ hasil build → site-preview/MealChainGuardian/)
 *   2. Chrome headless dengan CDP, mis.
 *      chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>/cdp-profile about:blank
 *
 * Pakai:
 *   node scripts/verify-dashboard-collapse.mjs [url] [cdpUrl]
 * Exit code: 0 = halaman hidup & deru mutasi wajar · 1 = halaman MATI atau deru tidak wajar.
 */

const URL_DASHBOARD = process.argv[2] || "http://127.0.0.1:4174/MealChainGuardian/dashboard/";
const CDP = process.argv[3] || process.env.CDP_URL || "http://127.0.0.1:9333";
const ORIGIN = new URL(URL_DASHBOARD).origin;
const BASE = new URL(URL_DASHBOARD).pathname.split("/").slice(0, 2).join("/") || "";
const AMBANG_ATTR = 200;
const TOKEN_KEY = "mealchain.token";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hubungkan() {
  const daftar = await (await fetch(`${CDP}/json/list`)).json();
  const halaman = daftar.find((t) => t.type === "page");
  if (!halaman) throw new Error(`tidak ada tab terbuka di ${CDP}`);
  const ws = new WebSocket(halaman.webSocketDebuggerUrl);
  let id = 0;
  const menunggu = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && menunggu.has(m.id)) {
      menunggu.get(m.id)(m);
      menunggu.delete(m.id);
    }
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`gagal menyambung ke CDP ${CDP} — jalankan Chrome dengan --remote-debugging-port`));
  });
  const kirim = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      menunggu.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const nilai = async (expression) => {
    const r = await kirim("Runtime.evaluate", { expression, returnByValue: true });
    return r.result?.result?.value;
  };
  return { ws, kirim, nilai };
}

async function main() {
  const { ws, kirim, nilai } = await hubungkan();
  await kirim("Page.enable");
  await kirim("Runtime.enable");
  await kirim("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Token demo disuntik langsung: mode nyata (.env.local NEXT_PUBLIC_USE_MOCK=false) tidak bisa
  // ditembus lewat UI tanpa backend hidup, dan yang diuji di sini tata letak, bukan autentikasi.
  await kirim("Page.navigate", { url: `${ORIGIN}${BASE}/login/` });
  await sleep(6000);
  await nilai(`(() => {
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\\//g, '_').replace(/\\+/g, '-');
    localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
      sub: 'user-sppg-head', role: 'sppg_head', locationId: 'loc-2', region: 'DKI Jakarta',
      name: 'Kepala SPPG Jakarta Utara', canApprove: true, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig');
    return 1;
  })()`);

  await kirim("Page.navigate", { url: URL_DASHBOARD });
  let siap = false;
  for (let i = 0; i < 40; i++) {
    siap = Boolean(
      await nilai(
        `!!document.querySelector('.recharts-wrapper') && !!document.querySelector('aside button[aria-label="Tutup sidebar"]')`
      )
    );
    if (siap) break;
    await sleep(1000);
  }
  if (!siap) throw new Error("dashboard tidak pernah siap (chart atau tombol rail tidak muncul)");
  await sleep(1500);

  // Kontrol positif: peta & jumlah bar chart harus ada, supaya "hidup" bukan berarti "halaman kosong".
  const sebelum = JSON.parse(
    await nilai(`(() => {
      window.__mutasi = { total: 0, attr: 0, childList: 0 };
      const akar = document.querySelector('.recharts-responsive-container') || document.querySelector('.recharts-wrapper');
      window.__obs = new MutationObserver((recs) => {
        for (const r of recs) {
          window.__mutasi.total++;
          if (r.type === 'attributes') window.__mutasi.attr++;
          else if (r.type === 'childList') window.__mutasi.childList++;
        }
      });
      window.__obs.observe(akar, { attributes: true, childList: true, subtree: true, characterData: true });
      return JSON.stringify({
        mutasi: window.__mutasi,
        bar: document.querySelectorAll('.recharts-bar-rectangle').length,
        marker: document.querySelectorAll('.maplibregl-marker').length,
      });
    })()`)
  );

  await nilai(`document.querySelector('aside button[aria-label="Tutup sidebar"]').click()`);
  await sleep(2500);

  const sesudah = JSON.parse(
    await nilai(`(() => JSON.stringify({
      mutasi: window.__mutasi,
      rail: Math.round(document.querySelector('aside').getBoundingClientRect().width),
      bar: document.querySelectorAll('.recharts-bar-rectangle').length,
      mati: /update depth|React error #\\d+/i.test(document.body.innerText),
    }))()`)
  );
  await nilai(`window.__obs && window.__obs.disconnect()`);
  ws.close();

  const attr = sesudah.mutasi.attr - sebelum.mutasi.attr;
  const childList = sesudah.mutasi.childList - sebelum.mutasi.childList;
  console.log(
    JSON.stringify(
      {
        url: URL_DASHBOARD,
        kontrolPositif: { barChart: sebelum.bar, penandaPeta: sebelum.marker },
        saatKlik: { mutasiAttr: attr, mutasiChildList: childList },
        sesudah: { lebarRail: sesudah.rail, barChartMasihAda: sesudah.bar },
        halamanMati: sesudah.mati,
        ambang: { mutasiAttr: AMBANG_ATTR },
      },
      null,
      1
    )
  );

  const gagal = [];
  if (sesudah.mati) gagal.push("halaman MATI oleh React #185");
  if (sebelum.bar === 0 || sebelum.marker === 0) gagal.push("kontrol positif kosong (chart/peta tidak ter-render)");
  if (attr > AMBANG_ATTR) gagal.push(`deru mutasi atribut ${attr} > ambang ${AMBANG_ATTR} (throttle ResponsiveContainer hilang?)`);
  if (sesudah.bar === 0) gagal.push("bar chart hilang setelah rail ditutup");

  if (gagal.length) {
    console.log(`HASIL: GAGAL — ${gagal.join("; ")}`);
    process.exit(1);
  }
  console.log("HASIL: LULUS — halaman hidup, chart utuh, deru mutasi atribut di bawah ambang");
}

main().catch((e) => {
  console.error(`HASIL: GAGAL — ${e.message}`);
  process.exit(1);
});
