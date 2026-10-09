"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useSupplierHistory, useSuppliers } from "@/hooks/use-data";
import type { SupplierScorePoint } from "@/lib/api/schema";
import { PALETTE } from "@/lib/design-tokens";
import { reliabilityTone } from "@/lib/reliability";
import { cn } from "@/lib/utils";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  });

/**
 * Grafik + tabel riwayat skor satu pemasok (design.md §3.9c).
 *
 * Sumbu Y dipatok 0,5–1,0 (bukan 0–1) supaya pergerakan skor yang halus tetap
 * terbaca. Titik insiden ditandai, jadi "sebelum/sesudah insiden" langsung kelihatan.
 */
export function ReliabilityHistory({ supplierId }: { supplierId: string }) {
  const suppliersQuery = useSuppliers();
  const { data, error, isPending, isFetching, refetch } =
    useSupplierHistory(supplierId);

  const supplier = suppliersQuery.data?.find((s) => s.id === supplierId) ?? null;

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.points.map((p: SupplierScorePoint) => ({
      label: p.at ? dateLabel(p.at) : "Awal",
      score: p.score,
      isIncident: p.isIncident,
      at: p.at,
    }));
  }, [data]);

  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }

  if (isPending || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Riwayat skor</CardTitle>
        </CardHeader>
        <CardContent>
          <SkeletonRows rows={4} />
        </CardContent>
      </Card>
    );
  }

  const tone = reliabilityTone(data.currentScore);
  const first = data.points[0]?.score ?? data.currentScore;
  const delta = data.currentScore - first;
  const incidents = data.events.filter((e) => e.outcome === "failure");

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle>{supplier ? supplier.name : supplierId}</CardTitle>
          <p className="text-muted-foreground">
            {data.events.length} pengiriman tercatat · {incidents.length} insiden ·
            skor awal periode {first.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-block h-2.5 w-2.5 rounded-full",
                tone === "safe"
                  ? "bg-status-safe"
                  : tone === "warning"
                    ? "bg-status-warning"
                    : "bg-status-danger",
              )}
            />
            <span className="text-2xl font-semibold tabular-nums text-navy-900">
              {data.currentScore.toFixed(2)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {delta === 0
              ? "sama dengan awal periode"
              : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(3)} vs awal periode`}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          className="h-[220px] w-full"
          role="img"
          aria-label={`Grafik skor kepercayaan ${supplierId}: ${data.points
            .map((p) => (p.at ? `${dateLabel(p.at)} ${p.score.toFixed(2)}` : `awal ${p.score.toFixed(2)}`))
            .join(", ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -18 }}>
              <CartesianGrid
                strokeDasharray="4 3"
                stroke={PALETTE.plotGrid}
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: PALETTE.grey500 }}
                axisLine={{ stroke: PALETTE.plotGrid }}
                tickLine={{ stroke: PALETTE.plotGrid }}
              />
              <YAxis
                domain={[0.5, 1]}
                ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]}
                tick={{ fontSize: 11, fill: PALETTE.grey500 }}
                axisLine={{ stroke: PALETTE.plotGrid }}
                tickLine={{ stroke: PALETTE.plotGrid }}
              />
              <Tooltip
                cursor={{ stroke: PALETTE.plotGrid, strokeWidth: 1, strokeDasharray: "4 2" }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${PALETTE.navy100}`,
                  background: "#fff",
                  color: PALETTE.navy900,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
                formatter={(value) => [
                  typeof value === "number" ? value.toFixed(3) : String(value),
                  "skor",
                ]}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PALETTE.brandBlue}
                strokeWidth={2.5}
                dot={{ r: 4, fill: PALETTE.brandBlue, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: PALETTE.brandBlue, stroke: "#fff", strokeWidth: 2 }}
              />
              {chartData
                .filter((p) => p.isIncident && p.at)
                .map((p) => (
                  <ReferenceDot
                    key={p.at}
                    x={p.label}
                    y={p.score}
                    r={6}
                    fill={PALETTE.statusDanger}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Tanggal</th>
                <th className="py-2 pr-3 font-medium">Keputusan</th>
                <th className="py-2 pr-3 font-medium">Kuantitas</th>
                <th className="py-2 pr-3 font-medium">Hasil</th>
                <th className="py-2 pr-3 font-medium">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {[...data.events].reverse().map((e) => (
                <tr key={`${e.decisionId}-${e.at}`} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-navy-900">
                    {dateLabel(e.at)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                    {e.decisionId}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-navy-900">
                    {e.quantityKg} kg
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={e.outcome === "success" ? "safe" : "danger"}>
                      {e.outcome === "success" ? "sukses" : "gagal"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {e.note ? (
                      <span className="flex items-start gap-1.5">
                        {e.outcome === "failure" && (
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-danger"
                            aria-hidden
                          />
                        )}
                        {e.note}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
