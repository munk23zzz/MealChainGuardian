"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { expiryLabel, expiryState, expiryTone } from "@/lib/expiry";
import { formatDateTime } from "@/lib/format";

/**
 * Hitung mundur masa berlaku keputusan (design.md §3.3).
 *
 * - Badge warna mengikuti token: lega = hijau, mendesak = kuning, kritis/lewat =
 *   merah, dan teksnya berubah menjadi "Kedaluwarsa" begitu `expires_at` lewat.
 * - `now` baru diisi setelah mount: kalau dihitung saat render server, teks
 *   relatif ("Sisa 2 jam 10 menit") akan berbeda antara HTML server dan klien
 *   sehingga React melaporkan hydration mismatch.
 * - Tanpa `expires_at` komponen ini tidak menampilkan apa pun — lebih baik tidak
 *   ada badge daripada badge waktu yang dikarang.
 */
export function ExpiryCountdown({
  expiresAt,
  className,
}: {
  expiresAt?: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt || now === null) return null;

  const state = expiryState(expiresAt, now);
  if (state === "none") return null;

  return (
    <Badge
      tone={expiryTone(state)}
      className={className}
      title={`Batas waktu eksekusi: ${formatDateTime(expiresAt)}${expiresAt ? "" : ""}`}
    >
      <Timer className="h-3 w-3" aria-hidden />
      <span className="tabular-nums">{expiryLabel(expiresAt, now)}</span>
    </Badge>
  );
}
