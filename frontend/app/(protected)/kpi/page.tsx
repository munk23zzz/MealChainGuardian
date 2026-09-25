"use client";

import { KPICard } from "@/components/kpi/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useKpi } from "@/hooks/use-data";
import { KPI_DEFINITIONS, kpiTrend } from "@/lib/kpi";
import { formatDateTime, formatKg } from "@/lib/format";

/**
 * KPI Dashboard (design.md §3.6): 7 KPI card, tiap card = angka besar + trend
 * kecil vs periode sebelumnya (kalau ada histori).
 *
 * Angka dihitung backend dari tabel `kpi_snapshots` (Skill.md §4) — frontend
 * hanya menampilkan.
 */
export default function KpiPage() {
  const { data: kpi, error, isPending, isFetching, refetch, dataUpdatedAt } =
    useKpi();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">KPI</h1>
          <p className="text-muted-foreground">
            Tujuh indikator kontinuitas pangan institusional (definisi di
            docs/Skill.md §4). Trend dibandingkan dengan periode sebelumnya.
          </p>
        </div>
        {dataUpdatedAt > 0 && (
          <span className="text-muted-foreground">
            {isFetching ? "memperbarui…" : "diperbarui"}{" "}
            {formatDateTime(new Date(dataUpdatedAt).toISOString())}
          </span>
        )}
      </div>

      {error && (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}

      {isPending || !kpi ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {KPI_DEFINITIONS.map((definition) => {
              const previous = kpi.previous?.[definition.key];
              return (
                <KPICard
                  key={definition.key}
                  definition={definition}
                  value={kpi[definition.key]}
                  trend={kpiTrend(kpi[definition.key], previous ?? null)}
                />
              );
            })}
          </div>

          {kpi.avoidableFoodLossRp > 0 && (
            <Card>
              <CardContent className="py-3">
                <span className="font-medium text-navy-900">
                  Nilai ekonomi food loss yang dihindari:{" "}
                </span>
                <span>
                  {new Intl.NumberFormat("id-ID", {
                    style: "currency",
                    currency: "IDR",
                    maximumFractionDigits: 0,
                  }).format(kpi.avoidableFoodLossRp)}
                </span>
                <span className="ml-2 text-muted-foreground">
                  ({formatKg(kpi.avoidableFoodLossKg)} setara)
                </span>
              </CardContent>
            </Card>
          )}

          {!kpi.previous && (
            <p className="text-muted-foreground">
              Histori periode sebelumnya belum tersedia — semua trend ditampilkan
              sebagai &quot;sama dengan periode sebelumnya&quot;, bukan dikarang.
            </p>
          )}
        </>
      )}
    </div>
  );
}
