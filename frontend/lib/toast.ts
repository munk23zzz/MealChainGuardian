/**
 * Toast store murni (tanpa DOM) — memisahkan kebijakan notifikasi dari render
 * supaya bisa diuji: batas jumlah, kedaluwarsa otomatis, dan dedupe.
 * Komponen `components/ui/toast.tsx` hanya menampilkan.
 */

export type ToastTone = "success" | "danger" | "info" | "warning";

export type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  createdAt: number;
  /** 0 = tidak hilang otomatis (mis. kegagalan yang harus dibaca). */
  durationMs: number;
};

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

/** Batas tampil: lebih dari ini jadi bising dan menutupi aksi utama. */
export const TOAST_LIMIT = 3;
export const DEFAULT_DURATION_MS = 6000;
export const ERROR_DURATION_MS = 0;

let sequence = 0;

/** Hanya untuk test agar id deterministik. */
export function resetToastSequence(): void {
  sequence = 0;
}

export function createToast(input: ToastInput, now: number): Toast {
  sequence += 1;
  const tone = input.tone ?? "info";
  return {
    id: sequence,
    title: input.title,
    description: input.description,
    tone,
    createdAt: now,
    durationMs:
      input.durationMs ?? (tone === "danger" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
  };
}

/** Terbaru di depan, dipotong pada TOAST_LIMIT. */
export function pushToast(list: Toast[], toast: Toast): Toast[] {
  return [toast, ...list].slice(0, TOAST_LIMIT);
}

export function dismissToast(list: Toast[], id: number): Toast[] {
  return list.filter((toast) => toast.id !== id);
}

export function expireToasts(list: Toast[], now: number): Toast[] {
  return list.filter(
    (toast) => toast.durationMs <= 0 || now - toast.createdAt < toast.durationMs,
  );
}

/** Sisa waktu (ms) sampai toast berikutnya kedaluwarsa; null bila tak ada. */
export function nextExpiryIn(list: Toast[], now: number): number | null {
  const timed = list.filter((toast) => toast.durationMs > 0);
  if (timed.length === 0) return null;
  const soonest = Math.min(
    ...timed.map((toast) => toast.createdAt + toast.durationMs),
  );
  return Math.max(0, soonest - now);
}
