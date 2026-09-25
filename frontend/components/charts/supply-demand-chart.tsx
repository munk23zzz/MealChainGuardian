"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
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

export function SupplyDemandChart({
  supplies,
  labelFor = (id) => id,
}: {
  supplies: SupplyRecord[];
  labelFor?: (locationId: string) => string;
}) {
  const data = buildSupplyDemandChartData(supplies).map((point) => ({
    ...point,
    name: labelFor(point.name),
  }));

  return (
    <div className="h-full min-h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={PALETTE.navy100} />
          <XAxis
            dataKey="name"
            fontSize={11}
            stroke={PALETTE.grey500}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={64}
          />
          <YAxis
            tickFormatter={(v) => formatCompactKg(Number(v))}
            fontSize={11}
            width={52}
            stroke={PALETTE.grey500}
          />
          <Tooltip
            formatter={(v) => formatKg(Number(v))}
            contentStyle={{
              fontFamily: "Inter, system-ui, sans-serif",
              border: `1px solid ${PALETTE.navy100}`,
              borderRadius: 8,
              color: PALETTE.navy900,
            }}
          />
          <Bar dataKey="supply" fill={PALETTE.navy700} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
