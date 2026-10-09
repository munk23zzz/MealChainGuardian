/**
 * Parameter URL untuk TAMPILAN (bukan otorisasi) — aturan skill UI/UX `deep-linking`:
 * "key screens must be reachable via deep link / URL for sharing", dan `state-preservation`:
 * kembali ke halaman sebelumnya harus memulihkan keadaan pilihan.
 *
 * Aturan penting yang mengikat modul ini: **URL tidak boleh memperluas cakupan peran.**
 * Karena itu yang masuk URL hanya PILIHAN di dalam data yang sudah lolos cakupan
 * (`matchParamToIds` menolak id apa pun yang tidak ada di daftar yang diberikan). Saklar
 * "tampilkan semua wilayah" SENGAJA tidak masuk URL: ia memperluas cakupan, dan tautan
 * semacam itu akan menyebar ke orang yang tidak berhak (Rules.md §1.4 cakupan peran).
 */

/**
 * Ambil id dari nilai parameter, HANYA kalau id itu memang ada di `ids` (yang sudah
 * disaring cakupan peran). Nilai asing/rusak → `null`, bukan ditebak.
 */
export function matchParamToIds(
  value: string | null | undefined,
  ids: readonly string[],
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return ids.includes(trimmed) ? trimmed : null;
}

/**
 * Bangun ulang query string dengan satu parameter diubah (`null`/kosong = dihapus),
 * parameter lain dipertahankan apa adanya. Menerima query string dengan atau tanpa "?".
 */
export function setQueryParam(
  search: string,
  key: string,
  value: string | null | undefined,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (value === null || value === undefined || value === "") {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}
