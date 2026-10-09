/**
 * Bantuan unggah gambar lapangan (murni): validasi + perhitungan penyusutan.
 * Kompresi sebenarnya dilakukan di canvas (komponen); di sini hanya angka,
 * supaya bisa diuji tanpa DOM.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_EDGE_DEFAULT = 1280;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type Size = { width: number; height: number };

export type DownscaleResult = Size & { scale: number };

/** Menjaga rasio; TIDAK pernah memperbesar gambar. Minimal 1 piksel. */
export function downscale(size: Size, maxEdge: number = MAX_EDGE_DEFAULT): DownscaleResult {
  const longest = Math.max(size.width, size.height);
  if (!Number.isFinite(longest) || longest <= 0 || maxEdge <= 0) {
    return { width: 1, height: 1, scale: 1 };
  }
  if (longest <= maxEdge) {
    return { width: Math.round(size.width), height: Math.round(size.height), scale: 1 };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    scale,
  };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ImageCheck = { ok: boolean; reason?: string };

export function isAcceptableImage(file: { type: string; size: number }): ImageCheck {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, reason: "Format harus JPG, PNG, atau WebP" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `Ukuran maksimal ${formatFileSize(MAX_UPLOAD_BYTES)} (foto ini ${formatFileSize(file.size)})`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, reason: "Berkas kosong" };
  }
  return { ok: true };
}

/** Perkiraan ukuran data URL setelah base64 (+33%) — untuk ditampilkan. */
export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.length - comma - 1;
  return Math.round((payload * 3) / 4);
}
