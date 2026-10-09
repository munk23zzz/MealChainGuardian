/**
 * Klasifikasi peran & cakupan data (design.md §1.4 "role-aware by default", §2 flow per peran).
 *
 * Murni — tidak menyentuh DOM/fetch. Dipakai UI untuk memutuskan APA yang
 * ditampilkan; otorisasi sebenarnya tetap di `lib/auth.ts` (+ backend).
 *
 * Aturan penting: peran yang mengurus satu wilayah JANGAN otomatis naik jadi
 * "semua wilayah" hanya karena data region-nya kosong. Gagal-tertutup.
 */
import type { Role } from "./api/schema";
import { scopeLabel, type DataScope } from "./scope";

export type { DataScope };

export const ROLE_LABELS: Record<Role, string> = {
  sppg_head: "Kepala SPPG",
  sppg_nutritionist: "Ahli Gizi SPPG",
  bgn_monitor: "Monitor BGN",
  sppg_staff: "Staff SPPG",
  dinas_admin: "Admin Dinas",
};

/** Kepala & Ahli Gizi SPPG: mengurus seluruh lokasi di wilayahnya. */
export function isRegionalRole(role: Role | null | undefined): boolean {
  return role === "sppg_head" || role === "sppg_nutritionist";
}

/** Monitor BGN & Admin Dinas: lintas wilayah (flow "Dinas/BGN Admin", design.md §2). */
export function isGlobalRole(role: Role | null | undefined): boolean {
  return role === "bgn_monitor" || role === "dinas_admin";
}

/** Staff SPPG: hanya lokasi tempat ia bekerja. */
export function isSingleLocationRole(role: Role | null | undefined): boolean {
  return role === "sppg_staff";
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
  if (isSingleLocationRole(role)) {
    return { kind: "location", locationId: identity.locationId ?? "" };
  }
  if (isRegionalRole(role)) {
    if (!identity.region) return { kind: "location", locationId: "" };
    return { kind: "region", region: identity.region };
  }
  return { kind: "all" };
}

/** Satu baris identitas peran untuk header UI, mis. "Kepala SPPG · DKI Jakarta · bisa approve". */
export function roleLine(identity: RoleIdentity): string {
  const label = identity.role ? ROLE_LABELS[identity.role] : "Tanpa peran";
  const scope = scopeForRole(identity.role, identity);
  const capability = identity.canApprove ? "bisa approve" : "read-only";
  return `${label} · ${scopeLabel(scope)} · ${capability}`;
}
