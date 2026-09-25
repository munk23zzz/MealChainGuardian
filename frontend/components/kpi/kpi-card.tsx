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
}: {
  definition: KpiDefinition;
  value: number;
  trend: KpiTrend;
}) {
  const improvement = trendIsImprovement(definition, trend);
  const Icon =
    trend.direction === "up" ? TrendingUp : trend.direction === "down" ? TrendingDown : Minus;

  const deltaLabel =
    trend.direction === "flat"
      ? "sama dengan periode sebelumnya"
      : `${trend.deltaAbs > 0 ? "+" : "−"}${Math.abs(trend.deltaPercent)}% vs periode sebelumnya`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground">{definition.label}</p>
        <p className="text-2xl font-semibold tabular-nums text-navy-900">
          {formatKpiValue(definition.key, value)}
        </p>
        <p
          className={cn(
            "flex items-center gap-1 text-xs",
            improvement === true && "text-status-safe",
            improvement === false && "text-status-danger",
            improvement === null && "text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {deltaLabel}
        </p>
        <p className="mt-1 text-muted-foreground">{definition.description}</p>
      </CardContent>
    </Card>
  );
}
