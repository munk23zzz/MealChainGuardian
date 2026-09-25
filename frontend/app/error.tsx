"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Error boundary level aplikasi (design.md §4: "Error (dengan retry action)").
 * Menampilkan pesan asli error + tombol coba lagi, bukan layar kosong.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Kesalahan aplikasi:", error);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorState
        message={error.message || "Terjadi kesalahan saat memuat halaman"}
        onRetry={reset}
      />
      <p className="mt-3 text-muted-foreground">
        Kalau tetap gagal, cek apakah backend/mock masih berjalan (NEXT_PUBLIC_USE_MOCK
        atau NEXT_PUBLIC_API_BASE_URL di .env.local).
      </p>
    </div>
  );
}
