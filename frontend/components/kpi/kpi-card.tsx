import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatKpiValue, trendIsImprovement, type KpiDefinition, type KpiTrend } from "@/lib/kpi";
import { cn } from "@/lib/utils";

/**
 * KPICard (design.md §3.6): angka besar + trend kecil (naik/turun vs periode
 * sebelumnya, kalau ada histori).
 *
 * Warna trend mengikuti arah yang MEMBAIK, bukan sekadar arah angka: food loss
 * naik itu buruk, meal continuity naik itu bagus (lihat `higherIsBetter`).
 */
export function KPICard({
  definition,
  value,
  trend,
  unavailableReason,
}: {
  definition: KpiDefinition;
  /** Kosong = KPI belum bisa dihitung backend; kartu menampilkan "—" + alasannya. */
  value: number | null | undefined;
  trend: KpiTrend;
  unavailableReason?: string;
}) {
  const missing = value === null || value === undefined || !Number.isFinite(value);
  const improvement = missing ? null : trendIsImprovement(definition, trend);
  const Icon =
    trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;

  const deltaLabel =
    trend.direction === "flat"
      ? "sama dengan periode sebelumnya"
      : `${trend.deltaAbs > 0 ? "+" : "−"}${Math.abs(trend.deltaPercent)}% vs periode sebelumnya`;

  return (
    <Card className="animate-fade-up h-full">
      <CardContent className="flex h-full flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">
          {definition.label}
        </p>
        <p className="text-2xl font-semibold tabular-nums text-navy-900">
          {formatKpiValue(definition.key, value)}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-navy-900">
          {missing ? (
            <span className="text-muted-foreground">
              {unavailableReason ?? "belum bisa dihitung — bukan 0"}
            </span>
          ) : (
            <>
              {improvement !== null && (
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    improvement ? "bg-status-safe" : "bg-status-danger",
                  )}
                />
              )}
              <Icon
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  improvement === true && "text-status-safe",
                  improvement === false && "text-status-danger",
                  improvement === null && "text-muted-foreground",
                )}
              />
              <span className={cn(improvement === null && "text-muted-foreground")}>
                {deltaLabel}
              </span>
            </>
          )}
        </p>
        {/* `mt-auto` bikin keterangan selalu rata bawah walau tinggi kartu beda — grid jadi rapi. */}
        <p className="mt-auto pt-2 text-xs text-muted-foreground">
          {definition.description}{" "}
          <span className="whitespace-nowrap">
            ({definition.higherIsBetter ? "makin tinggi makin baik" : "makin rendah makin baik"})
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
