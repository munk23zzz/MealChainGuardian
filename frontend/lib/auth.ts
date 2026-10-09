/**
 * Auth helpers murni (pure functions) — decode JWT dan cek role.
 * TIDAK memverifikasi signature (itu tugas backend); di client cukup decode
 * payload untuk menentukan UI/role gate. Sumber kebenaran otorisasi tetap backend.
 */
import type { JwtPayload } from "./api/schema";

/** Decode payload JWT (base64url) tanpa verifikasi signature. */
export function decodeJwt(token: string): JwtPayload | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1];
    // Normalisasi base64url -> base64 agar atob() dapat memprosesnya.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Cek apakah payload punya salah satu role yang diizinkan. */
export function hasRole(payload: JwtPayload | null, role: string): boolean {
  return payload?.role === role;
}

/**
 * Aturan RBAC:
 * - dinas_admin              : bisa approve untuk lokasi mana pun.
 * - sppg_head                : bisa approve untuk semua lokasi di region-nya.
 * - sppg_nutritionist        : bisa approve untuk semua lokasi di region-nya.
 * - sppg_staff               : hanya bisa approve untuk locationId miliknya.
 * - bgn_monitor              : read-only, tidak bisa approve.
 *
 * `locationRegion` = region dari lokasi target (mis. "DKI Jakarta").
 * Harus dilempar dari caller yang sudah punya daftar Location.
 */
export function canApproveForLocation(
  payload: JwtPayload | null,
  locationId: string,
  locationRegion?: string,
): boolean {
  if (!payload) return false;

  // Cek flag canApprove di JWT terlebih dulu (paling eksplisit)
  if (payload.canApprove === false) return false;

  if (payload.role === "dinas_admin") return true;

  if (payload.role === "sppg_head" || payload.role === "sppg_nutritionist") {
    if (!payload.region) return false;
    return !!locationRegion && locationRegion === payload.region;
  }

  if (payload.role === "sppg_staff") {
    return payload.locationId === locationId;
  }

  return false;
}

/**
 * Boleh-tidaknya user menyetujui SATU keputusan tertentu.
 *
 * Pembungkus `canApproveForLocation` yang mengurus hal yang mudah salah:
 * region diambil dari **lokasi tujuan** keputusan (bukan lokasi asal), dan
 * keputusan tanpa lokasi tujuan yang bisa dicocokkan → ditolak (gagal-tertutup).
 */
export function canApproveDecision(
  payload: JwtPayload | null,
  decision: { targetLocationId: string },
  locations: { id: string; region?: string | null }[],
): boolean {
  const target = locations.find((l) => l.id === decision.targetLocationId);
  if (!target) return false;
  return canApproveForLocation(payload, target.id, target.region ?? undefined);
}

/** Alasan penolakan approval, untuk kalimat penjelasan di UI (bukan untuk otorisasi). */
export function approvalDenialReason(
  payload: JwtPayload | null,
  decision: { targetLocationId: string },
  locations: { id: string; region?: string | null }[],
): "no-role" | "read-only" | "outside-region" | "unknown-location" | null {
  if (!payload?.role) return "no-role";
  if (payload.canApprove === false) return "read-only";
  const target = locations.find((l) => l.id === decision.targetLocationId);
  if (!target) return "unknown-location";
  if (canApproveDecision(payload, decision, locations)) return null;
  const scoped =
    payload.role === "sppg_head" || payload.role === "sppg_nutritionist";
  return scoped ? "outside-region" : "no-role";
}
