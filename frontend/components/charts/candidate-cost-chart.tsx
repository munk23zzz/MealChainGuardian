"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={PALETTE.navy100} />
          <XAxis
            type="number"
            tickFormatter={(v) => formatRupiah(v)}
            fontSize={11}
            stroke={PALETTE.grey500}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={132}
            fontSize={11}
            stroke={PALETTE.grey500}
          />
          <Tooltip
            formatter={(v) => `${formatRupiah(Number(v))}/kg`}
            contentStyle={{
              fontFamily: "Inter, system-ui, sans-serif",
              border: `1px solid ${PALETTE.navy100}`,
              borderRadius: 8,
              color: PALETTE.navy900,
            }}
          />
          <Bar dataKey="totalSafeDeliveredCostPerKg" radius={[0, 4, 4, 0]}>
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
