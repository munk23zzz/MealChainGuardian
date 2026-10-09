/**
 * Penyaring data per cakupan peran (design.md §1.4).
 *
 * Aturan yang disengaja: data di luar cakupan TIDAK dihapus diam-diam. Selalu
 * dikembalikan terpisah (`partitionByScope`) supaya UI bisa memberi tahu
 * "N di luar wilayah Anda" — pengguna tahu ada yang disembunyikan dan bisa
 * memilih melihatnya. Menyembunyikan tanpa jejak = menyembunyikan informasi.
 */
import type { Recommendation } from "./api/schema";

/**
 * Cakupan data yang boleh dilihat satu peran (dibuat oleh `scopeForRole` di
 * lib/role.ts). Didefinisikan di sini supaya tidak ada impor melingkar.
 */
export type DataScope =
  | { kind: "all" }
  | { kind: "region"; region: string }
  | { kind: "location"; locationId: string };

type LocationLike = { id: string; region?: string | null };

/** Label manusiawi cakupan. */
export function scopeLabel(scope: DataScope): string {
  if (scope.kind === "all") return "semua wilayah";
  if (scope.kind === "region") return scope.region;
  return "lokasi sendiri";
}

export function isLocationInScope(
  locationId: string,
  scope: DataScope,
  locations: LocationLike[],
): boolean {
  if (scope.kind === "all") return true;
  const location = locations.find((l) => l.id === locationId);
  if (!location) return false; // lokasi tak dikenal → jangan ditampilkan
  if (scope.kind === "region") return location.region === scope.region;
  return location.id === scope.locationId;
}

/**
 * Keputusan terlihat kalau SALAH SATU ujungnya ada di cakupan: lokasi asal
 * (pemasok/gudang di wilayahnya) maupun lokasi tujuan (SPPG yang ia urus).
 */
export function decisionTouchesScope(
  decision: Recommendation,
  scope: DataScope,
  locations: LocationLike[],
): boolean {
  if (scope.kind === "all") return true;
  return (
    isLocationInScope(decision.sourceLocationId, scope, locations) ||
    isLocationInScope(decision.targetLocationId, scope, locations)
  );
}

/** Pisahkan daftar jadi "di dalam cakupan" dan "di luarnya" (tanpa membuang apa pun). */
export function partitionByScope<T>(
  items: T[],
  inScope: (item: T) => boolean,
): { inScope: T[]; outOfScope: T[] } {
  const inside: T[] = [];
  const outside: T[] = [];
  for (const item of items) {
    if (inScope(item)) inside.push(item);
    else outside.push(item);
  }
  return { inScope: inside, outOfScope: outside };
}

/** Kalimat status cakupan untuk banner, mis. "menampilkan wilayah DKI Jakarta · 2 di luar wilayah Anda". */
export function scopeDescription(
  scope: DataScope,
  outOfScopeCount: number,
): string {
  if (scope.kind === "all") return "menampilkan semua wilayah";
  const noun = scope.kind === "region" ? "wilayah" : "lokasi";
  const base = `menampilkan ${noun} ${scopeLabel(scope)}`;
  if (outOfScopeCount <= 0) return base;
  return `${base} · ${outOfScopeCount} di luar ${noun} Anda`;
}

/**
 * Cocokkan NAMA WILAYAH dengan cakupan peran — untuk data yang hanya menyimpan wilayah,
 * bukan `locationId` (mis. batch mock yang tujuannya nama sekolah, `lib/region-map.ts`).
 *
 * Gagal-tertutup seperti penyaring lain: wilayah yang tidak diketahui JANGAN ditampilkan,
 * dan cakupan satu lokasi tidak pernah cocok dengan nama wilayah saja — kemiripan wilayah
 * bukan bukti bahwa itu lokasi milik pengguna.
 */
export function isRegionInScope(
  region: string | null | undefined,
  scope: DataScope,
): boolean {
  if (scope.kind === "all") return true;
  if (!region) return false;
  if (scope.kind === "region") return region === scope.region;
  return false;
}
