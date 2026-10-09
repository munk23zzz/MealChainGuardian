/**
 * Jendela aman "masak → konsumsi" (BGN: maksimal 4 jam setelah matang) dan
 * estimasi waktu tiba pengiriman. Murni + bisa diuji; komponen hanya merender.
 *
 * Semua fungsi menerima `now` sebagai argumen — jangan pernah memanggil
 * Date.now() di dalam render (menyebabkan mismatch hidrasi).
 */

/** BGN: batas konsumsi maksimal 4 jam setelah matang. */
export const SAFE_WINDOW_MS = 4 * 60 * 60 * 1000;
export const WARNING_REMAINING_MS = 60 * 60 * 1000;
export const CRITICAL_REMAINING_MS = 30 * 60 * 1000;

export type WindowTone = "safe" | "warning" | "danger";

export type ServeWindow = {
  cookedAt: number;
  deadline: number;
  elapsedMs: number;
  remainingMs: number;
  expired: boolean;
  tone: WindowTone;
  /** 0–100, untuk bilah kemajuan jendela. */
  percentElapsed: number;
};

export function windowTone(remainingMs: number, expired: boolean): WindowTone {
  if (expired) return "danger";
  if (remainingMs <= CRITICAL_REMAINING_MS) return "danger";
  if (remainingMs <= WARNING_REMAINING_MS) return "warning";
  return "safe";
}

export function serveWindow(
  cookedAt: number,
  now: number,
  windowMs: number = SAFE_WINDOW_MS,
): ServeWindow {
  const deadline = cookedAt + windowMs;
  const elapsedMs = Math.max(0, now - cookedAt);
  const remainingMs = deadline - now;
  const expired = remainingMs <= 0;
  const percentElapsed = Math.max(0, Math.min(100, (elapsedMs / windowMs) * 100));
  return {
    cookedAt,
    deadline,
    elapsedMs,
    remainingMs,
    expired,
    tone: windowTone(remainingMs, expired),
    percentElapsed,
  };
}

export function formatRemaining(remainingMs: number): string {
  const late = remainingMs <= 0;
  const total = Math.abs(remainingMs);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.round((total % 3_600_000) / 60_000);
  const body =
    hours > 0 ? `${hours} jam ${minutes} menit` : `${minutes} menit`;
  return late ? `lewat ${body}` : `${body} lagi`;
}

export type DeliveryPlan = {
  arrivesAt: number;
  travelMinutes: number;
  remainingOnArrivalMs: number;
  withinWindow: boolean;
  tone: WindowTone;
};

/** Apakah kiriman masih dalam jendela aman saat tiba di tujuan? */
export function planDelivery(
  cookedAt: number,
  now: number,
  travelMinutes: number,
  windowMs: number = SAFE_WINDOW_MS,
): DeliveryPlan {
  const arrivesAt = now + travelMinutes * 60_000;
  const deadline = cookedAt + windowMs;
  const remainingOnArrivalMs = deadline - arrivesAt;
  return {
    arrivesAt,
    travelMinutes,
    remainingOnArrivalMs,
    withinWindow: remainingOnArrivalMs > 0,
    tone: windowTone(remainingOnArrivalMs, remainingOnArrivalMs <= 0),
  };
}
