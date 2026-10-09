/**
 * Penyaring daftar pemasok (murni, teruji).
 *
 * Alasan modul ini ada: aturan skill UI/UX untuk dashboard data-padat menyebut "no filtering"
 * sebagai anti-pola — halaman yang menyodorkan 10+ baris tanpa cara mempersempitnya memaksa
 * pengguna memindai dengan mata. Logika penyaringnya ditaruh di sini supaya bisa diuji tanpa
 * merender: satu tempat, satu kebenaran, halaman tinggal memanggilnya.
 *
 * Catatan batas: penyaring ini bekerja DI DALAM hasil saringan cakupan peran. Ia tidak boleh
 * menerima daftar yang belum disaring peran, dan tidak boleh menambah data — hanya mengurangi.
 */

import type { Supplier } from "@/lib/api/schema";

/** Ambang "skor di bawah" — angka yang sama dengan badge di halaman Pemasok (design.md §3.9c). */
export const RELIABILITY_THRESHOLD = 0.85;

export type SupplierStatusFilter = "all" | "active" | "excluded";

export type SupplierFilter = {
  /** Pencocokan teks pada nama atau id pemasok (tidak peka huruf besar/kecil). */
  query?: string;
  status?: SupplierStatusFilter;
  /** Hanya pemasok dengan skor kepercayaan di bawah ambang. */
  belowThreshold?: boolean;
};

export function filterSuppliers(
  suppliers: Supplier[],
  filter: SupplierFilter,
): Supplier[] {
  const query = filter.query?.trim().toLowerCase();
  const status = filter.status ?? "all";

  return suppliers.filter((supplier) => {
    if (status !== "all" && supplier.status !== status) return false;
    if (filter.belowThreshold && supplier.reliabilityScore >= RELIABILITY_THRESHOLD) {
      return false;
    }
    if (query) {
      const haystack = [supplier.name, supplier.id].map((value) => value.toLowerCase());
      if (!haystack.some((value) => value.includes(query))) return false;
    }
    return true;
  });
}

/** Apakah ada penyaring yang benar-benar aktif (untuk menampilkan tombol "bersihkan"). */
export function isSupplierFilterActive(filter: SupplierFilter): boolean {
  return Boolean(
    filter.query?.trim() || (filter.status && filter.status !== "all") || filter.belowThreshold,
  );
}
