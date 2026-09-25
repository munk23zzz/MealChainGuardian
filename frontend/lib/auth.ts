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
 * Aturan RBAC (frontend.md §Hukum 5):
 * - dinas_admin bisa approve untuk lokasi mana pun.
 * - sppg_staff hanya bisa approve untuk locationId miliknya.
 */
export function canApproveForLocation(
  payload: JwtPayload | null,
  locationId: string,
): boolean {
  if (!payload) return false;
  if (payload.role === "dinas_admin") return true;
  if (payload.role === "sppg_staff") {
    return payload.locationId === locationId;
  }
  return false;
}
