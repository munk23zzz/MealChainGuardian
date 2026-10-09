"use client";

import { FlaskConical } from "lucide-react";
import {
  currentDataSource,
  dataSourceLabel,
  shouldShowDataSourceBadge,
} from "@/lib/data-source";
import { cn } from "@/lib/utils";

/**
 * Badge "Data Simulasi" — Rules.md §1.4 & workflows.md §6.4.
 *
 * Semua angka yang berasal dari mock SAP (bukan SAP asli) wajib terlihat jelas
 * di UI. Komponen ini sengaja tidak menerima props sumber data: sumbernya
 * ditentukan env `NEXT_PUBLIC_USE_MOCK` supaya tidak ada jalur untuk
 * "menyembunyikan" badge saat demo.
 */
export function DataSourceBadge({ className }: { className?: string }) {
  const source = currentDataSource(process.env.NEXT_PUBLIC_USE_MOCK);
  if (!shouldShowDataSourceBadge(source)) return null;

  return (
    <span
      title="Data pada sesi ini berasal dari mock SAP, bukan SAP produksi"
      className={cn(
        // `whitespace-nowrap shrink-0` mengikuti aturan skill UI/UX "Compact Label Overflow":
        // label ringkas yang nilainya tetap tidak boleh pecah ke baris kedua; yang mengalah
        // adalah kotak pencarian (flex-1) di sebelahnya, bukan labelnya.
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-navy-700/30 bg-navy-100 px-2 py-0.5 text-xs font-medium text-navy-900",
        className,
      )}
    >
      <FlaskConical className="h-3 w-3" />
      {dataSourceLabel(source)}
    </span>
  );
}
