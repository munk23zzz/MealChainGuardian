/**
 * Klasifikasi peran & cakupan data (design.md §1.4 "role-aware by default", §2 flow per peran).
 *
 * Murni — tidak menyentuh DOM/fetch. Dipakai UI untuk memutuskan APA yang
 * ditampilkan; otorisasi sebenarnya tetap di `lib/auth.ts` (+ backend).
 *
 * Aturan penting: peran yang mengurus satu SPPG JANGAN otomatis naik jadi "semua
 * wilayah" hanya karena data pendukungnya (region/locationId) kosong. Gagal-tertutup.
 */
import type { Role } from "./api/schema";
import { scopeLabel, type DataScope, type NamedLocationLike } from "./scope";

export type { DataScope };

export const ROLE_LABELS: Record<Role, string> = {
  sppg_head: "Kepala SPPG",
  sppg_nutritionist: "Ahli Gizi SPPG",
  bgn_monitor: "Monitor BGN",
  sppg_staff: "Staff SPPG",
  dinas_admin: "Admin Dinas",
};

/**
 * Peran yang cakupannya SATU SPPG (lokasi): kepala, ahli gizi, dan staff SPPG.
 *
 * Revisi 10 Okt 2026 — kepala & ahli gizi SPPG DULU dihitung "peran wilayah" (cakupan
 * seluruh `region`). Backend tidak pernah begitu: `backend/app/core/approval_rules.py`
 * menuntut approver berasal dari SPPG penerima (`approver_location_mismatch`). Cakupan
 * wilayah membuat UI menawarkan tombol Approve yang pasti ditolak server.
 */
export function isLocationBoundRole(role: Role | null | undefined): boolean {
  return role === "sppg_head" || role === "sppg_nutritionist" || role === "sppg_staff";
}

/** Monitor BGN & Admin Dinas: lintas wilayah (flow "Dinas/BGN Admin", design.md §2). */
export function isGlobalRole(role: Role | null | undefined): boolean {
  return role === "bgn_monitor" || role === "dinas_admin";
}

export interface RoleIdentity {
  role: Role | null;
  region: string | null;
  locationId: string | null;
  canApprove: boolean;
}

/**
 * Cakupan data yang pantas ditampilkan untuk peran ini.
 * Gagal-tertutup: peran wilayah/lokasi tanpa data pendukung dapat cakupan kosong,
 * bukan "all" (itu kebocoran data lintas wilayah).
 */
export function scopeForRole(
  role: Role | null | undefined,
  identity: Pick<RoleIdentity, "region" | "locationId">,
): DataScope {
  if (isLocationBoundRole(role)) {
    // Gagal-tertutup: tanpa `locationId` cakupannya KOSONG, bukan "all". `region` yang
    // terisi tidak boleh menaikkannya jadi "all" — itu kebocoran antar SPPG.
    return { kind: "location", locationId: identity.locationId ?? "" };
  }
  return { kind: "all" };
}

/** Satu baris identitas peran untuk header UI, mis. "Kepala SPPG · DKI Jakarta · bisa approve". */
export function roleLine(
  identity: RoleIdentity,
  locations?: NamedLocationLike[],
): string {
  const label = identity.role ? ROLE_LABELS[identity.role] : "Tanpa peran";
  const scope = scopeForRole(identity.role, identity);
  const capability = identity.canApprove ? "bisa approve" : "read-only";
  return `${label} · ${scopeLabel(scope, locations)} · ${capability}`;
}
