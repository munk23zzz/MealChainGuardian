"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ScopeNotice } from "@/components/layout/scope-notice";
import { SurplusPanel } from "@/components/surplus/surplus-panel";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { MOCK_BATCHES } from "@/lib/mock-compliance";
import { SURPLUS_ROLES } from "@/lib/nav";
import { partitionBatchesByScope } from "@/lib/region-map";
import { scopeForRole } from "@/lib/role";

/**
 * Surplus dan Limbah: dasar hukum Peraturan BGN No. 1 Tahun 2026 tentang penanganan sisa
 * pangan, sampah, dan limbah MBG. Panel alokasi memakai `now` dari useEffect agar tidak ada
 * mismatch hidrasi.
 *
 * Cakupan peran: halaman ini hanya ditawarkan kepada Kepala/Ahli Gizi SPPG (`lib/nav.ts`),
 * yaitu peran BERWILAYAH — jadi daftar batch-nya wajib dibatasi wilayah peran. Tanpa itu,
 * justru peran ber-cakupan wilayah yang membaca batch dari provinsi lain. Pemisahannya
 * memakai `partitionBatchesByScope` supaya jumlah di luar cakupan bisa disebut, bukan
 * dihapus diam-diam (`lib/scope.ts`).
 */
export default function SurplusPage() {
  const [now, setNow] = useState<number | null>(null);
  const { role, region, locationId, canApprove } = useAuth();
  const [showAllScopes, setShowAllScopes] = useState(false);

  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const effectiveScope = useMemo(
    () => (showAllScopes ? ({ kind: "all" } as const) : roleScope),
    [showAllScopes, roleScope],
  );
  const { inScope, outOfScope } = useMemo(
    () => partitionBatchesByScope(MOCK_BATCHES, effectiveScope),
    [effectiveScope],
  );

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // `empty-nav-state` (skill UI/UX): halaman yang tidak ditawarkan di sidebar untuk sebuah
  // peran harus MENJELASKAN alasannya bila tetap dibuka lewat URL — bukan berjalan seperti
  // biasa. Daftar perannya diambil dari `lib/nav.ts` supaya sidebar dan penjaga ini tidak
  // bisa berbeda diam-diam. `role` masih null saat auth dimuat → skeleton, bukan tuduhan.
  if (role && !SURPLUS_ROLES.includes(role)) {
    return (
      <div className="flex flex-col gap-6">
        <div className="animate-fade-up flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-navy-900">
            Surplus dan Limbah
          </h1>
        </div>
        <EmptyState
          title="Halaman ini untuk Kepala SPPG dan Ahli Gizi SPPG"
          description="Surplus & Limbah adalah kerja dapur: mengalihkan sisa pangan yang masih dalam jendela aman 4 jam saat tiba, lalu mencatat penanganan sisanya. Peran Anda memantau lintas wilayah lewat Dashboard, Keamanan Pangan, Keputusan, dan KPI."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/compliance">Buka Keamanan Pangan</Link>
            </Button>
          }
        />
      </div>
    );
  }

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
            Rencana disusun per batch wilayah tanggung jawab Anda.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton label="Salin tautan batch" />
          <DataSourceBadge />
        </div>
      </div>

      <ScopeNotice
        scope={effectiveScope}
        outsideCount={outOfScope.length}
        detail={`${inScope.length} dari ${MOCK_BATCHES.length} batch demo`}
        readOnly={!canApprove}
        canToggle={roleScope.kind !== "all"}
        showingAll={showAllScopes}
        roleScope={roleScope}
        onToggle={() => setShowAllScopes((value) => !value)}
      />

      <SurplusPanel
        now={now}
        batches={inScope}
        emptyAction={
          roleScope.kind !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllScopes(true)}
            >
              Tampilkan semua wilayah
            </Button>
          )
        }
      />
    </div>
  );
}
