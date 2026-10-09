"use client";

import { useMemo } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { MetricStrip } from "@/components/ui/metric-strip";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useLocations, useSuppliers } from "@/hooks/use-data";
import { useAuth } from "@/contexts/auth";
import { scopeForRole } from "@/lib/role";
import { isLocationInScope, scopeLabel } from "@/lib/scope";
import { locationLabel } from "@/lib/labels";
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

  /**
   * Batasan peran (design.md §1.4): pemasok dipetakan ke lokasi asalnya
   * (`supplier.locationId`), jadi kepala/ahli gizi hanya melihat pemasok yang
   * memasok lokasi di wilayahnya, sementara monitor BGN melihat semuanya.
   */
  const { role, region, locationId } = useAuth();
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
                <span className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">
                    {s.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {s.id} · {locationLabel(s.locationId, locations ?? [])}
                  </span>
                </span>
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
    </div>
  );
}
