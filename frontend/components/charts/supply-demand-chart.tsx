"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildSupplyDemandChartData } from "@/lib/chart-data";
import { PALETTE } from "@/lib/design-tokens";
import { formatKg } from "@/lib/format";
import type { SupplyRecord } from "@/lib/api/schema";

/** Label sumbu ringkas (mis. "2,3k") — nilai penuh tetap muncul di tooltip. */
function formatCompactKg(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1).replace(".", ",")}k`;
  }
  return String(value);
}

// Warna bar
const COLOR_SUPPLY = PALETTE.brandBlue;       // biru — stok tersedia
const COLOR_DEMAND = PALETTE.statusWarning;   // kuning — proyeksi kebutuhan

export function SupplyDemandChart({
  supplies,
  demands,
  labelFor = (id) => id,
}: {
  supplies: SupplyRecord[];
  /** Opsional — jika diisi, bar "Proyeksi kebutuhan" ikut ditampilkan. */
  demands?: { locationId: string; projectedKg: number }[];
  labelFor?: (locationId: string) => string;
}) {
  const data = buildSupplyDemandChartData(supplies, demands).map((point) => ({
    ...point,
    name: labelFor(point.name),
  }));

  return (
    <div className="h-full min-h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ left: 8, right: 16, top: 12, bottom: 4 }}
          barCategoryGap="28%"
          barGap={3}
        >
          {/* ── Grid: garis horizontal jelas, vertikal tipis ── */}
          <CartesianGrid
            strokeDasharray="4 3"
            vertical={true}
            horizontalPoints={undefined}
            stroke={PALETTE.plotGrid}
            strokeOpacity={0.6}
          />

          {/* ── Sumbu X ── */}
          <XAxis
            dataKey="name"
            fontSize={11}
            tick={{ fill: PALETTE.grey500 }}
            axisLine={{ stroke: PALETTE.plotGrid }}
            tickLine={{ stroke: PALETTE.plotGrid }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={68}
          />

          {/* ── Sumbu Y ── */}
          <YAxis
            tickFormatter={(v) => formatCompactKg(Number(v))}
            fontSize={11}
            width={52}
            tick={{ fill: PALETTE.grey500 }}
            axisLine={{ stroke: PALETTE.plotGrid }}
            tickLine={{ stroke: PALETTE.plotGrid }}
          />

          {/* ── Garis nol ── */}
          <ReferenceLine y={0} stroke={PALETTE.plotGrid} />

          {/* ── Tooltip ── */}
          <Tooltip
            cursor={{ fill: "rgba(9,105,218,0.06)" }}
            formatter={(v, name) => [
              formatKg(Number(v)),
              name === "supply" ? "Stok tersedia" : "Proyeksi kebutuhan",
            ]}
            contentStyle={{
              fontFamily: "Inter, system-ui, sans-serif",
              border: `1px solid ${PALETTE.navy100}`,
              borderRadius: 8,
              color: PALETTE.navy900,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          />

          {/* ── Legenda ── */}
          <Legend
            iconType="square"
            iconSize={10}
            formatter={(value) =>
              value === "supply" ? "Stok tersedia" : "Proyeksi kebutuhan"
            }
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          />

          {/* ── Bar supply ── */}
          <Bar
            dataKey="supply"
            name="supply"
            fill={COLOR_SUPPLY}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />

          {/* ── Bar demand (jika data chart mengandung kolom demand) ── */}
          <Bar
            dataKey="demand"
            name="demand"
            fill={COLOR_DEMAND}
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
