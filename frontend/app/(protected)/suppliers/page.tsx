"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { MetricStrip } from "@/components/ui/metric-strip";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { SupplierDetailPanel } from "@/components/suppliers/supplier-detail-panel";
import { useCommodities, useLocations, useSuppliers } from "@/hooks/use-data";
import { useUrlParam } from "@/hooks/use-url-param";
import { useAuth } from "@/contexts/auth";
import { proposeSupplierExclusion } from "@/lib/api";
import type { Supplier } from "@/lib/api/schema";
import { formatDateTime, formatScore } from "@/lib/format";
import { scopeForRole } from "@/lib/role";
import { isLocationInScope, scopeLabel } from "@/lib/scope";
import {
  RELIABILITY_THRESHOLD,
  filterSuppliers,
  isSupplierFilterActive,
  type SupplierStatusFilter,
} from "@/lib/supplier-filter";
import { matchParamToIds } from "@/lib/view-params";
import { commodityLabel, locationLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Kepercayaan Pemasok (design.md §3.9c, Schema.md §1).
 *
 * Yang ditampilkan: `suppliers.reliability_score` apa adanya dari backend. Skornya
 * STATIS (DEFAULT 0,80) — mekanisme LEARN yang dulu menurunkannya dari riwayat
 * penerimaan dihapus bersama `decisions.outcome` (revisi dokumen 9 Okt), jadi halaman
 * ini tidak lagi mengklaim ada pembelajaran dari insiden.
 */

/** Ambang pewarnaan di layar saja (bukan aturan domain): skala 0–1. */
function scoreTone(score: number): "safe" | "warning" | "danger" {
  if (score >= 0.85) return "safe";
  if (score >= 0.7) return "warning";
  return "danger";
}

export default function SuppliersPage() {
  const { data: suppliers, error, isPending, isFetching, refetch } = useSuppliers();
  const { data: locations } = useLocations();
  const { data: commodities } = useCommodities();

  /**
   * Panel detail (`GET /ui/suppliers/{id}`). Dibuka dari tombol "Detail" per baris ATAU
   * langsung lewat tautan `?pemasok=<id>` (skill `deep-linking`) — supaya seorang kepala bisa
   * mengirim persis pemasok yang sedang dibahas. Id dari URL hanya diterima bila ada di
   * `ordered`, yaitu daftar yang SUDAH tersaring cakupan peran: tautan tidak bisa membuka
   * pemasok di luar cakupan (Rules.md §1.4).
   */
  const [detailTarget, setDetailTarget] = useState<Supplier | null>(null);
  const [supplierParam, setSupplierParam] = useUrlParam("pemasok");
  const openDetail = (supplier: Supplier) => {
    setDetailTarget(supplier);
    setSupplierParam(supplier.id);
  };
  const closeDetail = () => {
    setDetailTarget(null);
    setSupplierParam(null);
  };

  /**
   * Batasan peran (design.md §1.4): pemasok dipetakan ke lokasi asalnya
   * (`supplier.locationId`), jadi kepala/ahli gizi hanya melihat pemasok yang
   * memasok lokasi di wilayahnya, sementara monitor BGN melihat semuanya.
   */
  const { role, region, locationId, canApprove: userCanApprove } = useAuth();
  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const scopedSuppliers = useMemo(
    () =>
      (suppliers ?? []).filter((s) =>
        isLocationInScope(s.locationId, roleScope, locations ?? []),
      ),
    [suppliers, roleScope, locations],
  );

  const ordered = useMemo(
    () => [...scopedSuppliers].sort((a, b) => a.reliabilityScore - b.reliabilityScore),
    [scopedSuppliers],
  );

  /**
   * Id pemasok yang panelnya terbuka: dari klik tombol, atau dari tautan `?pemasok=<id>`.
   * `matchParamToIds` menolak id apa pun yang tidak ada di `ordered` (daftar tersaring
   * cakupan), jadi tautan tidak bisa membuka pemasok di luar cakupan peran.
   */
  const detailId =
    detailTarget?.id ??
    matchParamToIds(
      supplierParam,
      ordered.map((item) => item.id),
    );

  /**
   * Penyaring daftar (skill UI/UX untuk dashboard data-padat: "no filtering" anti-pola).
   * Logikanya di `lib/supplier-filter.ts` yang teruji — halaman hanya menyimpan pilihan.
   * Penyaring bekerja DI DALAM hasil cakupan peran; ia tidak bisa menambah data.
   */
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierStatus, setSupplierStatus] = useState<SupplierStatusFilter>("all");
  const [belowOnly, setBelowOnly] = useState(false);
  const filterActive = isSupplierFilterActive({
    query: supplierQuery,
    status: supplierStatus,
    belowThreshold: belowOnly,
  });
  const visible = useMemo(
    () =>
      filterSuppliers(ordered, {
        query: supplierQuery,
        status: supplierStatus,
        belowThreshold: belowOnly,
      }),
    [ordered, supplierQuery, supplierStatus, belowOnly],
  );
  const clearFilter = () => {
    setSupplierQuery("");
    setSupplierStatus("all");
    setBelowOnly(false);
  };

  /**
   * Eksklusi pemasok (`Rules.md` §1.2). Dialog ini HANYA mengirim USULAN: yang tercatat adalah
   * keputusan berstatus `pending_approval`, dan `suppliers.status` baru berubah setelah approver
   * SPPG pemasok menyetujuinya di halaman Keputusan. Karena itu tombol di sini tidak pernah
   * memakai kata "eksklusi sekarang".
   */
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [exclusionTarget, setExclusionTarget] = useState<Supplier | null>(null);
  const [exclusionReason, setExclusionReason] = useState("");
  const [exclusionError, setExclusionError] = useState<string | null>(null);

  const exclusionMutation = useMutation({
    mutationFn: () => proposeSupplierExclusion(exclusionTarget?.id ?? "", exclusionReason),
    onSuccess: (decision) => {
      setExclusionTarget(null);
      setExclusionReason("");
      setExclusionError(null);
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      push({
        title: "Usulan eksklusi tercatat",
        description: `Keputusan ${decision.id} menunggu approval SPPG pemasok — eksklusi belum berlaku.`,
        tone: "warning",
      });
    },
    onError: (err: unknown) => {
      setExclusionError(err instanceof Error ? err.message : "Gagal mengirim usulan");
    },
  });

  const metrics = useMemo(() => {
    const list = scopedSuppliers;
    if (list.length === 0) return [];
    const avg = list.reduce((sum, s) => sum + s.reliabilityScore, 0) / list.length;
    const lowest = list.reduce((min, s) =>
      s.reliabilityScore < min.reliabilityScore ? s : min,
    );
    const below = list.filter((s) => s.reliabilityScore < RELIABILITY_THRESHOLD).length;
    return [
      {
        label: "Pemasok terpantau",
        value: String(list.length),
        hint: "pemasok di cakupan Anda",
      },
      {
        label: "Rata-rata skor",
        value: formatScore(avg),
        hint: "skala 0–1 (Schema.md §1)",
        tone: scoreTone(avg),
      },
      {
        label: "Skor terendah",
        value: `${formatScore(lowest.reliabilityScore)} · ${lowest.id}`,
        hint: lowest.name,
        tone: scoreTone(lowest.reliabilityScore),
      },
      {
        label: `Di bawah ${formatScore(RELIABILITY_THRESHOLD)}`,
        value: String(below),
        hint: "perlu perhatian",
        tone: below > 0 ? "warning" : "safe",
      },
    ] as const;
  }, [scopedSuppliers]);

  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (scopedSuppliers.length === 0) {
    return (
      <EmptyState
        title={
          roleScope.kind === "all"
            ? "Belum ada pemasok terdaftar"
            : `Tidak ada pemasok untuk ${scopeLabel(roleScope, locations ?? [])}`
        }
        description={
          roleScope.kind === "all"
            ? "Pemasok muncul di sini begitu ada di master data backend (`suppliers`)."
            : "Cakupan peran Anda membatasi daftar ke lokasi itu. Pemasok di luar cakupan tidak ditampilkan di sini — akun monitor BGN melihat seluruh wilayah."
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up">
        <h1 className="text-xl font-semibold text-navy-900">Kepercayaan Pemasok</h1>
        <p className="text-muted-foreground">
          Skor kepercayaan tiap pemasok{" "}
          <span className="font-mono">suppliers.reliability_score</span> — salah satu
          masukan Candidate Score keputusan berikutnya (Schema.md §1, Skill.md §3).
        </p>
        <p className="text-muted-foreground">
          {roleScope.kind === "all"
            ? "Cakupan Anda: semua wilayah."
            : `Cakupan Anda: ${scopeLabel(roleScope, locations ?? [])} — hanya pemasok lokasi di cakupan itu yang ditampilkan.`}
        </p>
        {!userCanApprove && (
          <p className="text-muted-foreground">
            Peran Anda read-only: usulan eksklusi diajukan Kepala/Ahli Gizi SPPG,
            dan penelusurannya lewat tombol Detail di tiap pemasok.
          </p>
        )}
      </div>

      <MetricStrip items={[...metrics]} className="animate-fade-up" />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="flex flex-col gap-3 lg:col-span-3">
          <h2 className="font-semibold text-navy-900">Pemasok</h2>

          {/* Penyaring daftar. Pola kelasnya disamakan dengan filter Agent Log supaya dua
              layar tidak punya gaya filter yang berbeda (skill: `navigation-consistency`). */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
            <label className="flex min-w-[10rem] flex-1 items-center">
              <span className="sr-only">Cari pemasok</span>
              <input
                value={supplierQuery}
                onChange={(e) => setSupplierQuery(e.target.value)}
                placeholder="Cari nama atau id pemasok…"
                className="h-11 w-full rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Status:</span>
              <select
                value={supplierStatus}
                onChange={(e) => setSupplierStatus(e.target.value as SupplierStatusFilter)}
                className="h-11 cursor-pointer rounded-md border border-input bg-background px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9"
              >
                <option value="all">Semua status</option>
                <option value="active">Aktif</option>
                <option value="excluded">Dikecualikan</option>
              </select>
            </label>
            <Button
              type="button"
              variant={belowOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={belowOnly}
              onClick={() => setBelowOnly((value) => !value)}
              className="cursor-pointer"
            >
              Skor &lt; {formatScore(RELIABILITY_THRESHOLD)}
            </Button>
            {filterActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilter}
                className="cursor-pointer"
              >
                Bersihkan
              </Button>
            )}
          </div>

          <p className="text-xs text-grey-500" role="status">
            {filterActive
              ? `Menampilkan ${visible.length} dari ${ordered.length} pemasok di cakupan Anda.`
              : `${ordered.length} pemasok di cakupan Anda.`}
          </p>

          {visible.length === 0 ? (
            <EmptyState
              title="Tidak ada pemasok yang cocok"
              description="Penyaring yang aktif tidak menyisakan satu pun pemasok di cakupan Anda. Pemasok di luar cakupan peran tidak ikut dihitung."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearFilter}
                  className="cursor-pointer"
                >
                  Bersihkan penyaring
                </Button>
              }
            />
          ) : (
            visible.map((s, i) => {
            const tone = scoreTone(s.reliabilityScore);
            return (
              <div
                key={s.id}
                style={{ animationDelay: `${i * 50}ms` }}
                className="animate-fade-up flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-brand/40 hover:bg-accent/40"
              >
                <button
                  type="button"
                  onClick={() => openDetail(s)}
                  aria-label={`Lihat detail ${s.name}`}
                  className="min-h-11 min-w-0 flex-1 basis-40 cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  <span className="flex items-center gap-2 truncate font-medium text-navy-900">
                    {s.name}
                    {s.status === "excluded" && <Badge tone="danger">Dikecualikan</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.id} · {locationLabel(s.locationId, locations ?? [])}
                  </span>
                  {s.status === "excluded" && (
                    <span className="block text-xs text-status-danger">
                      {s.exclusionReason ?? "alasan tercatat di keputusan"}
                      {s.excludedAt ? ` · ${formatDateTime(s.excludedAt)}` : ""}
                    </span>
                  )}
                </button>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      tone === "safe"
                        ? "bg-status-safe"
                        : tone === "warning"
                          ? "bg-status-warning"
                          : "bg-status-danger",
                    )}
                    aria-hidden
                  />
                  <span className="tabular-nums font-semibold text-navy-900">
                    {formatScore(s.reliabilityScore)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => openDetail(s)}>
                    Detail
                  </Button>
                  {s.status === "active" && userCanApprove && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExclusionError(null);
                        setExclusionReason("");
                        setExclusionTarget(s);
                      }}
                    >
                      Ajukan eksklusi
                    </Button>
                  )}
                </span>
              </div>
            );
            })
          )}
        </section>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <Info className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <CardTitle>Dari mana angka ini</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-navy-900">
              <p className="text-muted-foreground">
                Dibaca langsung dari kolom{" "}
                <span className="font-mono">suppliers.reliability_score</span> (nilai
                DEFAULT 0,80). Frontend tidak menghitung ulang dan tidak menaksir sendiri.
              </p>
              <p className="text-muted-foreground">
                Skor menjadi salah satu masukan Candidate Score saat kandidat pemasok
                disusun untuk keputusan baru — keputusan yang sudah lewat tidak diubah.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone="safe">skor ≥ 0,85</Badge>
                <Badge tone="warning">0,70 – 0,84</Badge>
                <Badge tone="danger">&lt; 0,70</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={exclusionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setExclusionTarget(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajukan eksklusi {exclusionTarget?.name}?</DialogTitle>
            <DialogDescription>
              Usulan ini <strong>tidak</strong> langsung mengecualikan pemasok. Ia tercatat
              sebagai keputusan dan baru berlaku setelah disetujui Kepala/Ahli Gizi SPPG
              pemasok itu (Rules.md §1.2) — approver di luar SPPG tersebut akan ditolak.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-navy-900">Alasan eksklusi</span>
            <textarea
              value={exclusionReason}
              onChange={(e) => setExclusionReason(e.target.value)}
              placeholder="Contoh: dua pengiriman terakhir gagal inspeksi suhu"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">
              Wajib diisi — alasan ini ikut tersimpan di keputusan dan dibaca approver.
            </span>
          </label>

          {exclusionError && (
            <p role="alert" className="text-status-danger">
              {exclusionError}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExclusionTarget(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => exclusionMutation.mutate()}
              disabled={exclusionMutation.isPending || exclusionReason.trim().length < 10}
            >
              {exclusionMutation.isPending ? "Mengirim…" : "Kirim usulan eksklusi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierDetailPanel
        supplierId={detailId ?? null}
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        locationLabel={(id) => locationLabel(id, locations ?? [])}
        commodityLabel={(id) => commodityLabel(id, commodities ?? [])}
      />
    </div>
  );
}
