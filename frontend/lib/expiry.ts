/**
 * Hitung mundur masa berlaku keputusan (`decisions.expires_at`, Schema.md §3).
 *
 * design.md §3.3: countdown `expires_at` ditampilkan; kalau lewat batas, badge
 * berubah jadi "Kedaluwarsa". Schema.md §6: keputusan yang lewat `expires_at`
 * tidak pernah `executed` — jadi keadaan ini harus terlihat, bukan disembunyikan.
 *
 * Murni (tanpa React/DOM) dan menerima `now` supaya bisa diuji deterministik.
 */
import type { Tone } from "./design-tokens";

export type ExpiryState = "none" | "safe" | "warning" | "critical" | "expired";

/** Di bawah 15 menit: masih bisa dieksekusi, tapi sudah mendesak. */
const CRITICAL_MS = 15 * 60_000;
/** Di bawah 2 jam: perlu perhatian sebelum bergeser jadi kritis. */
const WARNING_MS = 2 * 60 * 60_000;

/**
 * Sisa waktu dalam ms. Negatif bila sudah lewat (tidak diklem ke nol, supaya
 * pemanggil bisa membedakan "habis" dari "tidak ada batas").
 * `null` = tidak ada `expires_at` atau nilainya tidak bisa dibaca sebagai tanggal.
 */
export function remainingMs(
  expiresAt: string | undefined,
  now: number = Date.now(),
): number | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  return at - now;
}

export function expiryState(
  expiresAt: string | undefined,
  now: number = Date.now(),
): ExpiryState {
  const remaining = remainingMs(expiresAt, now);
  if (remaining === null) return "none";
  if (remaining <= 0) return "expired";
  if (remaining < CRITICAL_MS) return "critical";
  if (remaining < WARNING_MS) return "warning";
  return "safe";
}

/**
 * Nada visual mengikuti token design.md §4 — tidak ada warna baru.
 * "critical" memakai danger karena berarti keputusan akan hilang kalau tidak
 * segera diproses; "expired" juga danger (kehilangan nyata, bukan sekadar info).
 */
export function expiryTone(state: ExpiryState): Tone {
  switch (state) {
    case "safe":
      return "safe";
    case "warning":
      return "warning";
    case "critical":
      return "danger";
    case "expired":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Label siap tampil. Sengaja tidak memakai angka desimal dan tidak pernah
 * mengarang waktu saat `expires_at` tidak ada ("-").
 */
export function expiryLabel(
  expiresAt: string | undefined,
  now: number = Date.now(),
): string {
  const remaining = remainingMs(expiresAt, now);
  if (remaining === null) return "-";
  if (remaining <= 0) return "Kedaluwarsa";

  const totalMinutes = Math.floor(remaining / 60_000);
  if (totalMinutes < 1) {
    const seconds = Math.max(1, Math.floor(remaining / 1000));
    return `Sisa ${seconds} detik`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Sisa ${minutes} menit`;
  if (minutes === 0) return `Sisa ${hours} jam`;
  return `Sisa ${hours} jam ${minutes} menit`;
}
