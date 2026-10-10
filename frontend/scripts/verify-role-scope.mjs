/**
 * Harness cakupan peran (permanen): 3 akun demo x apa yang BENAR-BENAR mereka lihat.
 *
 * Latar belakang (10 Okt 2026): role Kepala SPPG dipersempit dari "seluruh wilayah" ke
 * SATU SPPG supaya UI selaras dengan aturan backend (`backend/app/core/approval_rules.py`:
 * approval hanya sah bila approver berasal dari SPPG penerima, kode `approver_location_mismatch`).
 * Perubahan seperti ini gampang mundur tanpa terlihat: tes unit `lib/*.test.ts` menguji fungsi
 * murni, bukan halaman yang dirender dengan token yang benar. Harness ini menutup celah itu —
 * ia MASUK lewat tombol "akun demo" (jalur yang sama dengan juri), lalu MENGUKUR layarnya.
 *
 * Yang diperiksa:
 *   1. Kepala SPPG   : lokasi yang terlihat = 1 (SPPG Jakarta Utara), bukan 5 SPPG DKI.
 *   2. Kepala SPPG   : keputusan SPPG-nya bisa di-approve (tombol "Setujui…" ada).
 *   3. Kepala SPPG   : keputusan SPPG lain ditolak dengan kalimat "bukan SPPG Anda".
 *   4. Ahli gizi SPPG: SPPG-nya SAMA dengan kepala — syarat alur 2 approval (`verifier_flagged`).
 *   5. Monitor BGN   : melihat 10 lokasi, dan TIDAK punya tombol approve (read-only).
 *   6. Tidak ada akun demo yang lokasinya mengarang: nama lokasi yang tampil harus ada di
 *      daftar lokasi dataset (`lib/mock-data.ts`).
 *
 * Akun diambil dari SATU sumber (`lib/demo-accounts.ts`) supaya harness tidak menyimpang
 * kalau email/password demo berubah.
 *
 * Pakai:
 *   node scripts/verify-role-scope.mjs                          # pratinjau lokal (default :4174)
 *   node scripts/verify-role-scope.mjs https://munk23zzz.github.io/MealChainGuardian
 *   CDP_URL=http://127.0.0.1:9333 node scripts/verify-role-scope.mjs
 * Keluar dengan kode 1 bila ada pemeriksaan yang gagal.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:4174/MealChainGuardian").replace(/\/$/, "");
const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Akun demo + cakupan yang diharapkan, dibaca dari sumber tunggal. */
function bacaAkun() {
  const teks = readFileSync(join(FRONTEND, "lib", "demo-accounts.ts"), "utf8");
  const pola =
    /role: "(sppg_head|sppg_nutritionist|bgn_monitor)",\s*\n\s*label: "([^"]+)",\s*\n\s*username: "([^"]+)",\s*\n\s*password: "([^"]+)"/g;
  const akun = [];
  for (const m of teks.matchAll(pola)) {
    akun.push({ role: m[1], label: m[2], username: m[3], password: m[4] });
  }
  if (akun.length !== 3) {
    throw new Error(`harus 3 akun demo di lib/demo-accounts.ts, terbaca ${akun.length}`);
  }
  return akun;
}

/** Nama lokasi dataset — untuk menolak lokasi karangan. */
function bacaNamaLokasi() {
  const teks = readFileSync(join(FRONTEND, "lib", "mock-data.ts"), "utf8");
  // Kolomnya disejajarkan dengan spasi, jadi pemisahnya harus `\s+` bukan satu spasi.
  return [...teks.matchAll(/name: "([^"]+)",\s+region: "[^"]+",\s+latitude/g)].map((m) => m[1]);
}

/**
 * Harapan per peran.
 *   - `approve`     : id keputusan yang tombol "Setujui…"-nya HARUS muncul.
 *   - `tanpaTombol` : id keputusan yang tombol "Setujui…"-nya TIDAK BOLEH muncul
 *                     (SPPG lain, atau peran read-only).
 *   - `jumlahFeed`  : jumlah kartu di feed keputusan (cakupan peran, bukan semua).
 *   - `penjelasan`  : opsional, kalimat yang harus muncul di halaman keputusan itu.
 *
 * Catatan: pada data demo sekarang TIDAK ada keputusan `pending_approval`/`verifier_flagged`
 * yang tujuannya SPPG lain, jadi kalimat "bukan SPPG Anda" belum bisa muncul di peramban —
 * ia dikunci tes unit `lib/auth-scope.test.ts` (`outside-sppg`). Yang diuji di peramban adalah
 * jaminan yang lebih penting: tombol approve TIDAK muncul untuk SPPG lain.
 */
const HARAPAN = {
  sppg_head: {
    jumlahLokasi: 1,
    lokasi: "SPPG Jakarta Utara",
    jumlahFeed: 3,
    approve: ["dec-001", "dec-002"],
    tanpaTombol: ["dec-003"],
  },
  sppg_nutritionist: {
    jumlahLokasi: 1,
    lokasi: "SPPG Jakarta Utara",
    jumlahFeed: 3,
    approve: ["dec-002"],
    tanpaTombol: ["dec-003"],
  },
  bgn_monitor: {
    jumlahLokasi: 10,
    lokasi: null,
    jumlahFeed: 5,
    approve: [],
    tanpaTombol: ["dec-001"],
    penjelasan: { id: "dec-001", kalimat: /tidak punya hak approval|read-only/i, nama: "read-only" },
  },
};

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
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };

  const pergi = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 25; i += 1) {
      await sleep(500);
      const siap = await nilai("document.readyState === 'complete'");
      if (siap) return;
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { ws, nilai, pergi };
}

/** Ukur isi layar: lokasi yang tampil, banner cakupan, dan jumlah kartu keputusan. */
const SKRIP_LOKASI = `(() => {
  // Hanya kartu lokasi dashboard — tautan lain juga memuat "location=loc-..." (mis.
  // "Lihat keputusan →" di daftar perhatian) dan pernah membuat hitungannya salah.
  // href-nya "/<base>/dashboard/?location=loc-2" — ada garis miring sebelum "?".
  const tautan = [...document.querySelectorAll('a[href*="dashboard/?location=loc-"]')];
  const nama = [...new Set(tautan.map((a) => a.textContent.trim()).filter(Boolean))];
  const catatan = [...document.querySelectorAll('p')]
    .map((el) => el.textContent.trim())
    .find((t) => /^dari \d+ lokasi di cakupan Anda$/.test(t)) || null;
  const jumlahCatatan = catatan ? Number(catatan.match(/\d+/)[0]) : null;
  const banner = [...document.querySelectorAll('p,span')]
    .map((el) => el.textContent.trim())
    .find((teks) => teks.startsWith('menampilkan ')) || null;
  return { jumlah: nama.length, nama, banner, judulBanner: banner, catatan, jumlahCatatan };
})()`;

const SKRIP_FEED = `(() => {
  const tautan = [...document.querySelectorAll('a[href*="/decisions/dec-"]')];
  return {
    jumlah: tautan.length,
    id: tautan.map((a) => (a.getAttribute('href') || '').split('/').filter(Boolean).pop()),
  };
})()`;

/** Status approval satu halaman keputusan: tombol Setujui ada? penolakan disebut? */
const SKRIP_KEPUTUSAN = `(() => {
  const teks = document.body.innerText;
  const tombol = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
  return {
    adaTombolSetujui: tombol.some((t) => t.startsWith('Setujui')),
    sebutReadOnly: /read-only|tidak punya hak approval/i.test(teks),
    sebutBukanSppg: /bukan SPPG Anda/i.test(teks),
    sebutLuarCakupan: /di luar cakupan/i.test(teks),
  };
})()`;

async function main() {
  const akun = bacaAkun();
  const namaLokasi = bacaNamaLokasi();
  const { nilai, pergi } = await sesi();

  for (const a of akun) {
    const harap = HARAPAN[a.role];
    console.log(`\n=== ${a.label} (${a.username})`);

    // Masuk lewat tombol akun demo — jalur yang sama dengan yang dipakai juri.
    await pergi(`${BASE}/login/?periksa=${Date.now()}`);
    const diklik = await nilai(`(() => {
      const tombol = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.includes(${JSON.stringify(a.username)}));
      if (!tombol) return false;
      tombol.click();
      return true;
    })()`);
    if (!diklik) {
      periksa(`${a.label}: tombol akun demo ada`, false, "tidak menemukan tombol");
      continue;
    }

    let masuk = false;
    for (let i = 0; i < 30; i += 1) {
      await sleep(500);
      const url = await nilai("location.pathname");
      if (typeof url === "string" && url.includes("/dashboard")) {
        masuk = true;
        break;
      }
    }
    periksa(`${a.label}: masuk lewat tombol akun demo`, masuk, masuk ? undefined : "tidak pindah ke /dashboard");
    if (!masuk) continue;

    // Tunggu peta/daftar lokasi terisi.
    for (let i = 0; i < 20; i += 1) {
      const siap = await nilai(`document.querySelectorAll('a[href*="location=loc-"]').length > 0`);
      if (siap) break;
      await sleep(500);
    }
    const lokasi = await nilai(SKRIP_LOKASI);

    periksa(
      `${a.label}: ${harap.jumlahLokasi} lokasi terlihat`,
      lokasi.jumlah === harap.jumlahLokasi,
      `terlihat ${lokasi.jumlah}${lokasi.nama.length ? ` (${lokasi.nama.join(", ")})` : ""}`,
    );
    if (harap.lokasi) {
      periksa(
        `${a.label}: lokasinya ${harap.lokasi}`,
        lokasi.nama.includes(harap.lokasi),
        lokasi.nama.join(", ") || "tidak ada",
      );
    }
    periksa(
      `${a.label}: nama lokasi dikenal dataset`,
      lokasi.nama.every((n) => namaLokasi.includes(n)),
      lokasi.nama.filter((n) => !namaLokasi.includes(n)).join(", ") || "semua dikenal",
    );
    if (lokasi.jumlahCatatan !== null) {
      console.log(`         kartu KPI: "${lokasi.catatan}"`);
      periksa(
        `${a.label}: kartu KPI menghitung ${harap.jumlahLokasi} lokasi cakupan`,
        lokasi.jumlahCatatan === harap.jumlahLokasi,
        lokasi.catatan,
      );
    }
    if (lokasi.banner) {
      console.log(`         banner: "${lokasi.banner}"`);
      if (harap.lokasi) {
        periksa(
          `${a.label}: banner menyebut cakupan SPPG, bukan wilayah`,
          lokasi.banner.includes("di luar SPPG Anda") && !/wilayah/i.test(lokasi.banner),
          lokasi.banner,
        );
      }
    }

    // Feed keputusan: hitung kartu + sebutkan cakupannya.
    await pergi(`${BASE}/decisions/`);
    for (let i = 0; i < 20; i += 1) {
      const siap = await nilai(`document.querySelectorAll('a[href*="/decisions/dec-"]').length > 0`);
      if (siap) break;
      await sleep(500);
    }
    const feed = await nilai(SKRIP_FEED);
    console.log(`         feed keputusan: ${feed.jumlah} kartu (${feed.id.join(", ")})`);
    periksa(
      `${a.label}: feed keputusan = ${harap.jumlahFeed} kartu`,
      feed.jumlah === harap.jumlahFeed,
      `${feed.jumlah} kartu (${feed.id.join(", ") || "tanpa id"})`,
    );

    // Keputusan contoh: yang HARUS bisa di-approve, dan yang HARUS ditolak.
    for (const id of harap.approve) {
      await pergi(`${BASE}/decisions/${id}/`);
      await sleep(1200);
      const k = await nilai(SKRIP_KEPUTUSAN);
      periksa(
        `${a.label}: ${id} bisa di-approve`,
        k.adaTombolSetujui && !k.sebutBukanSppg,
        `tombol=${k.adaTombolSetujui} bukanSppg=${k.sebutBukanSppg}`,
      );
    }
    for (const id of harap.tanpaTombol) {
      await pergi(`${BASE}/decisions/${id}/`);
      await sleep(1200);
      const k = await nilai(SKRIP_KEPUTUSAN);
      periksa(
        `${a.label}: ${id} tanpa tombol approve (SPPG lain / read-only)`,
        !k.adaTombolSetujui,
        `tombol=${k.adaTombolSetujui} bukanSppg=${k.sebutBukanSppg} readOnly=${k.sebutReadOnly}`,
      );
    }
    if (harap.penjelasan) {
      await pergi(`${BASE}/decisions/${harap.penjelasan.id}/`);
      await sleep(1200);
      const k = await nilai(SKRIP_KEPUTUSAN);
      periksa(
        `${a.label}: ${harap.penjelasan.id} menyebut alasan ${harap.penjelasan.nama}`,
        harap.penjelasan.kalimat.test(
          `${k.sebutBukanSppg ? "bukan SPPG Anda " : ""}${k.sebutReadOnly ? "read-only" : ""}`,
        ) && (k.sebutBukanSppg || k.sebutReadOnly),
        `bukanSppg=${k.sebutBukanSppg} readOnly=${k.sebutReadOnly}`,
      );
    }

    // Keluar supaya akun berikutnya tidak mewarisi sesi ini.
    await nilai(`(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.includes('mealchain')) localStorage.removeItem(k);
      }
      return 1;
    })()`);
  }

  const gagal = hasil.filter((h) => !h.lulus);
  console.log(
    `\n${gagal.length === 0 ? "LULUS" : "GAGAL"}  ${hasil.length - gagal.length}/${hasil.length} pemeriksaan`,
  );
  if (gagal.length > 0) {
    for (const g of gagal) console.log(`   - ${g.nama}${g.detail ? ` (${g.detail})` : ""}`);
  }
  process.exit(gagal.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("harness gagal dijalankan:", err.message);
  process.exit(1);
});
