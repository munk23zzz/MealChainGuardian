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
 */
import { isRegionInScope, partitionByScope, type DataScope } from "./scope";

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
 */
export function partitionBatchesByScope<T extends { destination: string }>(
  batches: T[],
  scope: DataScope,
): { inScope: T[]; outOfScope: T[] } {
  return partitionByScope(batches, (batch) =>
    isRegionInScope(regionForDestination(batch.destination), scope),
  );
}
