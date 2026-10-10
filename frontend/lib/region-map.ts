/**
 * Pemetaan wilayah DEMO untuk data mock yang hanya punya NAMA tujuan, bukan id lokasi.
 *
 * `lib/mock-compliance.ts` menyimpan batch sebagai nama sekolah/kantor tujuan
 * ("SDN 05 Jakarta Utara", "SMPN 3 Bogor") tanpa `locationId`, sedangkan penyaring
 * cakupan peran (`lib/scope.ts`) bekerja atas id lokasi atau nama wilayah. Modul ini
 * jembatannya — sengaja murni dan teruji supaya halaman yang memakainya tidak mengarang
 * pencocokan sendiri.
 *
 * Aturan: tujuan yang tidak dikenali mengembalikan `null`, dan `isRegionInScope`
 * memperlakukan `null` sebagai "jangan ditampilkan" (gagal-tertutup). Satu batch hilang
 * dari daftar lebih baik daripada data wilayah lain bocor ke layar peran wilayah.
 *
 * Revisi 10 Okt 2026: peran SPPG (kepala/ahli gizi/staff) bercakupan SATU SPPG, bukan
 * wilayah. Tanpa pemetaan nama tujuan → id lokasi, cakupan satu lokasi tidak akan pernah
 * cocok dengan nama wilayah sehingga halaman Surplus/Compliance/Today jadi KOSONG untuk
 * kepala SPPG — "kosong" yang mudah disalahartikan sebagai "tidak ada data".
 */
import {
  isLocationInScope,
  isRegionInScope,
  partitionByScope,
  type DataScope,
  type NamedLocationLike,
} from "./scope";

/** Kata kunci wilayah demo — nilainya HARUS sama dengan `region` di `lib/mock-data.ts`. */
export const DESTINATION_REGION_KEYWORDS: { region: string; keywords: string[] }[] = [
  { region: "DKI Jakarta", keywords: ["jakarta"] },
  {
    region: "Jawa Barat",
    keywords: ["bogor", "depok", "bekasi", "cianjur", "bandung", "sukabumi"],
  },
  { region: "Banten", keywords: ["tangerang", "serang", "cilegon", "lebak", "pandeglang"] },
];

/** Wilayah demo dari nama tujuan pengiriman; `null` kalau tidak dikenali. */
export function regionForDestination(destination: string): string | null {
  const text = destination.toLowerCase();
  for (const entry of DESTINATION_REGION_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) return entry.region;
  }
  return null;
}

/**
 * Pisahkan batch berdasarkan cakupan peran. Mengembalikan yang di luar cakupan juga
 * (bukan membuangnya) agar UI bisa menyebut jumlahnya — aturan `lib/scope.ts`.
 *
 * `locations` wajib diisi untuk cakupan satu SPPG (itulah yang dipakai kepala/ahli gizi
 * SPPG); untuk cakupan wilayah/lintas wilayah argumennya tidak dipakai tapi tetap boleh
 * dikirim supaya pemanggil tidak perlu bercabang.
 */
export function partitionBatchesByScope<T extends { destination: string }>(
  batches: T[],
  scope: DataScope,
  locations: NamedLocationLike[] = [],
): { inScope: T[]; outOfScope: T[] } {
  return partitionByScope(batches, (batch) =>
    scope.kind === "location"
      ? isLocationInScope(
          locationForDestination(batch.destination, locations) ?? "",
          scope,
          locations,
        )
      : isRegionInScope(regionForDestination(batch.destination), scope),
  );
}

/**
 * Nama lokasi menjadi kata kunci tempat: "SPPG Jakarta Utara" → "jakarta utara",
 * "Gudang Cianjur" → "cianjur". Diturunkan dari nama di dataset supaya pemetaan tidak
 * bisa menyimpang dari daftar lokasi (kalau lokasi berganti nama, kata kuncinya ikut).
 */
function kataKunciLokasi(name: string): string {
  return name.toLowerCase().replace(/^(sppg|gudang|depo|dapur|posko)\s+/, "").trim();
}

/**
 * Id lokasi dari nama tujuan pengiriman; `null` kalau tidak ada yang cocok.
 *
 * Kata kunci TERPANJANG yang menang: "SDN 05 Jakarta Utara" harus jatuh ke SPPG Jakarta
 * Utara, bukan tertangkap lokasi lain yang namanya kebetulan cocok lebih pendek.
 * Gagal-tertutup: tujuan di luar daftar lokasi demo → `null`.
 */
export function locationForDestination(
  destination: string,
  locations: NamedLocationLike[],
): string | null {
  const text = destination.toLowerCase();
  let cocok: { id: string; panjang: number } | null = null;

  for (const location of locations) {
    if (!location.name) continue;
    const kataKunci = kataKunciLokasi(location.name);
    if (!kataKunci || !text.includes(kataKunci)) continue;
    if (cocok === null || kataKunci.length > cocok.panjang) {
      cocok = { id: location.id, panjang: kataKunci.length };
    }
  }

  return cocok?.id ?? null;
}
