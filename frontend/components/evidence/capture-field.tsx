"use client";

/**
 * Input bukti foto untuk dipakai di dapur (ponsel).
 *
 * Foto langsung dikompresi di peramban sebelum dikirim: jaringan lapangan
 * lambat, dan foto kamera ponsel bisa 4–8 MB. Validasi + hitungan penyusutan
 * ada di `lib/image.ts` (teruji); komponen ini mengurus DOM canvas.
 */

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downscale,
  estimateDataUrlBytes,
  formatFileSize,
  isAcceptableImage,
  MAX_EDGE_DEFAULT,
} from "@/lib/image";

export type CapturedPhoto = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
};

export function CaptureField({
  label = "Foto bukti",
  onChange,
  maxEdge = MAX_EDGE_DEFAULT,
}: {
  label?: string;
  onChange?: (photo: CapturedPhoto | null) => void;
  maxEdge?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (next: CapturedPhoto | null) => {
    setPhoto(next);
    onChange?.(next);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const check = isAcceptableImage({ type: file.type, size: file.size });
    if (!check.ok) {
      setError(check.reason ?? "Berkas tidak dapat dipakai");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await compress(file, maxEdge);
      const size = await imageSize(dataUrl);
      const bytes = estimateDataUrlBytes(dataUrl);
      reset({
        dataUrl,
        width: size.width,
        height: size.height,
        bytes,
        originalBytes: file.size,
      });
    } catch {
      setError("Gagal memproses foto — coba lagi atau pakai foto lain");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-navy-900">{label}</span>

      {photo ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.dataUrl}
            alt="Pratinjau foto bukti"
            className="max-h-48 w-full rounded-md object-cover"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-navy-700">
            <span className="tabular-nums">
              {photo.width}×{photo.height} px
            </span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {formatFileSize(photo.bytes)} (asli {formatFileSize(photo.originalBytes)})
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              reset(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Hapus foto
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Camera className="h-4 w-4" aria-hidden />
          )}
          {busy ? "Memproses foto…" : "Ambil / pilih foto"}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {error && (
        <p role="alert" className="text-xs text-status-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Foto disusutkan otomatis sebelum dikirim — hemat kuota di lokasi.
      </p>
    </div>
  );
}

/** Baca berkas → gambar → canvas → JPEG terkompresi (data URL). */
function compress(file: File, maxEdge: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("gagal membaca berkas"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("gagal memuat gambar"));
      image.onload = () => {
        const target = downscale(
          { width: image.naturalWidth, height: image.naturalHeight },
          maxEdge,
        );
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas tidak tersedia"));
          return;
        }
        ctx.drawImage(image, 0, 0, target.width, target.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataUrl;
  });
}
