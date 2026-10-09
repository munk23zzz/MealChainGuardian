"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildCandidateCostChartData } from "@/lib/chart-data";
import { PALETTE } from "@/lib/design-tokens";
import { formatRupiah } from "@/lib/format";
import type { CandidateCostBreakdown } from "@/lib/api/schema";

/**
 * Perbandingan kandidat berdasarkan total Safe Delivered Cost.
 * Kandidat dengan biaya terendah (yang direkomendasikan) dibedakan warnanya.
 */
export function CandidateCostChart({
  candidates,
}: {
  candidates: CandidateCostBreakdown[];
}) {
  const data = buildCandidateCostChartData(candidates);
  const cheapest = Math.min(
    ...data.map((d) => d.totalSafeDeliveredCostPerKg),
    Number.POSITIVE_INFINITY,
  );

  return (
    <div className="h-48 w-full">
      {/* `debounce` sama alasannya dengan SupplyDemandChart: tanpa throttle, deru ukuran
          dari tata letak yang beranimasi bisa menembus batas update React (#185). */}
      <ResponsiveContainer width="100%" height="100%" debounce={150}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
          {/* Grid — garis vertikal saja (chart horizontal) */}
          <CartesianGrid
            strokeDasharray="4 3"
            horizontal={false}
            stroke={PALETTE.plotGrid}
            strokeOpacity={0.6}
          />

          {/* Sumbu X — nilai Rupiah */}
          <XAxis
            type="number"
            tickFormatter={(v) => formatRupiah(v)}
            fontSize={11}
            tick={{ fill: PALETTE.grey500 }}
            axisLine={{ stroke: PALETTE.plotGrid }}
            tickLine={{ stroke: PALETTE.plotGrid }}
          />

          {/* Sumbu Y — nama kandidat */}
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            fontSize={11}
            tick={{ fill: PALETTE.grey500 }}
            axisLine={{ stroke: PALETTE.plotGrid }}
            tickLine={false}
          />

          {/* Garis referensi nilai terendah */}
          {cheapest !== Number.POSITIVE_INFINITY && (
            <ReferenceLine
              x={cheapest}
              stroke={PALETTE.statusSafe}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: "terbaik",
                position: "top",
                fontSize: 10,
                fill: PALETTE.statusSafe,
              }}
            />
          )}

          {/* Tooltip */}
          <Tooltip
            cursor={{ fill: "rgba(9,105,218,0.06)" }}
            formatter={(v) => [`${formatRupiah(Number(v))}/kg`, "Safe Delivered Cost"]}
            contentStyle={{
              fontFamily: "Inter, system-ui, sans-serif",
              border: `1px solid ${PALETTE.navy100}`,
              borderRadius: 8,
              color: PALETTE.navy900,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          />

          <Bar
            dataKey="totalSafeDeliveredCostPerKg"
            radius={[0, 4, 4, 0]}
            maxBarSize={28}
          >
            {data.map((point) => (
              <Cell
                key={point.name}
                fill={
                  point.totalSafeDeliveredCostPerKg === cheapest
                    ? PALETTE.statusSafe
                    : PALETTE.navy700
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
