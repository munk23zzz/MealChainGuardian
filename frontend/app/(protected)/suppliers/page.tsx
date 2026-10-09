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
import { useAuth } from "@/contexts/auth";
import { proposeSupplierExclusion } from "@/lib/api";
import type { Supplier } from "@/lib/api/schema";
import { formatDateTime } from "@/lib/format";
import { scopeForRole } from "@/lib/role";
import { isLocationInScope, scopeLabel } from "@/lib/scope";
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
   * Panel detail (`GET /ui/suppliers/{id}`). Dibuka dari tombol "Detail" per baris; id pemasok
   * menjadi kunci query, jadi panel yang sama dipakai untuk semua baris — tidak ada panel per baris
   * yang memanggil backend sebelum diminta.
   */
  const [detailTarget, setDetailTarget] = useState<Supplier | null>(null);

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
    const below = list.filter((s) => s.reliabilityScore < 0.85).length;
    return [
      {
        label: "Pemasok terpantau",
        value: String(list.length),
        hint: "pemasok di cakupan Anda",
      },
      {
        label: "Rata-rata skor",
        value: avg.toFixed(2),
        hint: "skala 0–1 (Schema.md §1)",
        tone: scoreTone(avg),
      },
      {
        label: "Skor terendah",
        value: `${lowest.reliabilityScore.toFixed(2)} · ${lowest.id}`,
        hint: lowest.name,
        tone: scoreTone(lowest.reliabilityScore),
      },
      {
        label: "Di bawah 0,85",
        value: String(below),
        hint: "perlu perhatian di keputusan berikutnya",
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
            : `Tidak ada pemasok untuk ${scopeLabel(roleScope)}`
        }
        description={
          roleScope.kind === "all"
            ? "Pemasok muncul di sini begitu ada di master data backend (`suppliers`)."
            : "Cakupan peran Anda membatasi daftar ke wilayah itu. Pemasok wilayah lain tidak ditampilkan di sini — akun monitor BGN melihat seluruh wilayah."
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
            : `Cakupan Anda: ${scopeLabel(roleScope)} — hanya pemasok lokasi di wilayah itu yang ditampilkan.`}
        </p>
        {!userCanApprove && (
          <p className="text-muted-foreground">
            Peran Anda read-only: usulan eksklusi diajukan Kepala/Ahli Gizi SPPG,
            dan penelusurannya lewat tombol Detail di tiap pemasok.
          </p>
        )}
      </div>

      <MetricStrip items={[...metrics]} className="animate-fade-up" />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-navy-900">Pemasok</h2>
          {ordered.map((s, i) => {
            const tone = scoreTone(s.reliabilityScore);
            return (
              <div
                key={s.id}
                style={{ animationDelay: `${i * 50}ms` }}
                className="animate-fade-up flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => setDetailTarget(s)}
                  aria-label={`Lihat detail ${s.name}`}
                  className="min-w-0 flex-1 rounded-md text-left"
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
                <span className="flex shrink-0 items-center gap-2">
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
                    {s.reliabilityScore.toFixed(2)}
                  </span>
                  <Button variant="ghost" onClick={() => setDetailTarget(s)}>
                    Detail
                  </Button>
                  {s.status === "active" && userCanApprove && (
                    <Button
                      variant="outline"
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
          })}
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
        supplierId={detailTarget?.id ?? null}
        open={detailTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDetailTarget(null);
        }}
        locationLabel={(id) => locationLabel(id, locations ?? [])}
        commodityLabel={(id) => commodityLabel(id, commodities ?? [])}
      />
    </div>
  );
}
