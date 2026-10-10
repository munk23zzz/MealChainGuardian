"use client";

import { useMemo } from "react";
import { KPICard } from "@/components/kpi/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { MetricStrip } from "@/components/ui/metric-strip";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useKpi } from "@/hooks/use-data";
import { useAuth } from "@/contexts/auth";
import { scopeForRole } from "@/lib/role";
import type { KPI } from "@/lib/api/schema";
import {
  KPI_DEFINITIONS,
  kpiLabel,
  kpiTrend,
  trendIsImprovement,
} from "@/lib/kpi";
import { formatDateTime, formatKg, formatRupiah } from "@/lib/format";

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
  const { role, region, locationId } = useAuth();
  const scope = scopeForRole(role, { region, locationId });

  /** Hitungan arah trend — diturunkan dari data, bukan angka terpisah. */
  const trends = useMemo(() => {
    if (!kpi) return { improved: 0, worsened: 0, flat: 0 };
    let improved = 0;
    let worsened = 0;
    let flat = 0;
    for (const definition of KPI_DEFINITIONS) {
      const verdict = trendIsImprovement(
        definition,
        kpiTrend(kpi[definition.key], kpi.previous?.[definition.key] ?? null),
      );
      if (verdict === true) improved += 1;
      else if (verdict === false) worsened += 1;
      else flat += 1;
    }
    return { improved, worsened, flat };
  }, [kpi]);

  const { improved, worsened, flat } = trends;
  /** Nilai rupiah food loss yang dihindari; kosong = belum ada sumbernya di skema (bukan 0). */
  const foodLossRp = kpi?.avoidableFoodLossRp ?? 0;
  /** KPI yang belum bisa dihitung backend — ditampilkan sebagai "—" beserta alasannya. */
  const unavailable = Object.entries(kpi?.unavailable ?? {}) as [keyof KPI, string][];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">KPI</h1>
          <p className="text-muted-foreground">
            Tujuh indikator kontinuitas pangan institusional (definisi di
            docs/Skill.md §4). Trend dibandingkan dengan periode sebelumnya.
          </p>
          <p className="text-muted-foreground">
            {scope.kind === "all"
              ? "Cakupan angka: global (semua wilayah)."
              : "Catatan jujur untuk demo: angka KPI ini dihitung global di backend, belum ada pemecahan per wilayah/SPPG — jadi ini BUKAN angka cakupan Anda saja."}
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
          <MetricStrip
            className="animate-fade-up"
            items={[
              {
                label: "Periode berjalan",
                value: `${improved} / ${KPI_DEFINITIONS.length}`,
                hint: "KPI membaik vs periode sebelumnya",
                tone: improved > 0 ? "safe" : "neutral",
              },
              {
                label: "Perlu perhatian",
                value: String(worsened),
                hint: "KPI memburuk vs periode sebelumnya",
                tone: worsened > 0 ? "warning" : "safe",
              },
              {
                label: "Tanpa histori",
                value: String(flat),
                hint: "belum ada pembanding — tidak dikarang",
                tone: "neutral",
              },
            ]}
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {KPI_DEFINITIONS.map((definition) => {
              const previous = kpi.previous?.[definition.key];
              return (
                <KPICard
                  key={definition.key}
                  definition={definition}
                  value={kpi[definition.key]}
                  trend={kpiTrend(kpi[definition.key], previous ?? null)}
                  unavailableReason={kpi.unavailable?.[definition.key]}
                />
              );
            })}
          </div>

          {foodLossRp > 0 && (
            <Card className="animate-fade-up border-l-4 border-l-status-safe">
              <CardContent className="flex flex-wrap items-baseline gap-x-2 py-3">
                <span className="font-medium text-navy-900">
                  Nilai ekonomi food loss yang dihindari:
                </span>
                <span className="text-lg font-semibold tabular-nums text-navy-900">
                  {formatRupiah(foodLossRp)}
                </span>
                <span className="text-muted-foreground">
                  ({formatKg(kpi.avoidableFoodLossKg ?? 0)} setara)
                </span>
              </CardContent>
            </Card>
          )}

          {unavailable.length > 0 && (
            <Card className="animate-fade-up">
              <CardContent className="flex flex-col gap-2 py-4">
                <p className="text-sm font-medium text-navy-900">
                  KPI yang belum bisa dihitung (ditampilkan &quot;—&quot;, bukan 0):
                </p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {unavailable.map(([key, reason]) => (
                    <li key={key}>
                      <span className="font-medium text-navy-900">{kpiLabel(key)}</span>: {reason}
                    </li>
                  ))}
                </ul>
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
