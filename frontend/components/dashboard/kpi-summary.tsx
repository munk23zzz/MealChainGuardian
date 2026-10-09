"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useKpi } from "@/hooks/use-data";
import {
  KPI_DEFINITIONS,
  formatKpiValue,
  kpiTrend,
  trendIsImprovement,
} from "@/lib/kpi";
import { cn } from "@/lib/utils";
import type { KPI } from "@/lib/api/schema";

/**
 * Ringkasan KPI untuk peran lintas wilayah (flow "Dinas/BGN Admin", design.md §2):
 * cukup untuk mengarahkan perhatian, bukan pengganti halaman KPI.
 *
 * Angka dihitung backend dari `kpi_snapshots` (Skill.md §4) — di mock ini masih
 * global, jadi pemecahan per wilayah TIDAK dikarang di sini.
 */
const KEY_KPIS: (keyof KPI)[] = [
  "mealContinuityRate",
  "avoidableFoodLossKg",
  "averageDecisionTimeMinutes",
  "evidenceCompletenessPercent",
];

export function KpiSummary() {
  const { data: kpi, isPending } = useKpi();
  const definitions = KPI_DEFINITIONS.filter((d) => KEY_KPIS.includes(d.key));

  return (
    <Card className="animate-fade-up">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Ringkasan KPI</CardTitle>
          <p className="text-muted-foreground">
            Indikator kontinuitas pangan — angka global (per wilayah belum ada di
            backend demo).
          </p>
        </div>
        <Link href="/kpi" className="tap-target text-sm text-brand hover:underline">
          KPI lengkap →
        </Link>
      </CardHeader>
      <CardContent>
        {isPending || !kpi ? (
          <SkeletonRows rows={2} />
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {definitions.map((definition) => {
              const value = kpi[definition.key];
              const trend = kpiTrend(value, kpi.previous?.[definition.key] ?? null);
              const improvement = trendIsImprovement(definition, trend);
              return (
                <div key={definition.key} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {improvement !== null && (
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          improvement ? "bg-status-safe" : "bg-status-danger",
                        )}
                      />
                    )}
                    <span className="truncate">{definition.label}</span>
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums text-navy-900">
                    {formatKpiValue(definition.key, value)}
                  </dd>
                  <dt className="sr-only">perubahan</dt>
                  <dd className="text-xs text-muted-foreground tabular-nums">
                    {trend.direction === "flat"
                      ? "sama dengan periode sebelumnya"
                      : `${trend.deltaAbs > 0 ? "+" : "−"}${Math.abs(trend.deltaPercent)}% vs periode sebelumnya`}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
