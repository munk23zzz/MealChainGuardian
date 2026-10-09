"use client";

import { useEffect, useState } from "react";
import { SurplusPanel } from "@/components/surplus/surplus-panel";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { SkeletonCard } from "@/components/ui/skeleton";

/**
 * Surplus dan Limbah: dasar hukum Peraturan BGN No. 1 Tahun 2026 tentang
 * penanganan sisa pangan, sampah, dan limbah MBG. Panel alokasi memakai `now`
 * dari useEffect agar tidak ada mismatch hidrasi.
 */
export default function SurplusPage() {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (now === null) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">
            Surplus dan Limbah
          </h1>
          <p className="text-muted-foreground">
            Sisa pangan yang masih dalam jendela aman 4 jam saat tiba boleh
            dialihkan ke penerima lain; sisanya wajib dicatat penanganannya.
          </p>
        </div>
        <DataSourceBadge />
      </div>

      <SurplusPanel now={now} />
    </div>
  );
}
