/**
 * 7 KPI (design.md §3.6, definisi di docs/Skill.md) + indikator trend.
 * Murni — tidak ada fetch/DOM.
 */
import type { KPI } from "./api/schema";
import { formatKg, formatMinutes, formatPercent, formatRupiah } from "./format";

export interface KpiDefinition {
  key: keyof KPI;
  label: string;
  description: string;
  /** true = makin besar makin baik (dipakai untuk mewarnai trend). */
  higherIsBetter: boolean;
}

/** Urutan mengikuti design.md §3.6. */
export const KPI_DEFINITIONS: KpiDefinition[] = [
  {
    key: "mealContinuityRate",
    label: "Meal Continuity Rate",
    description: "% hari SPPG dapat pasokan tepat waktu tanpa gangguan",
    higherIsBetter: true,
  },
  {
    key: "avoidableFoodLossKg",
    label: "Avoidable Food Loss",
    description: "kg food loss yang dapat dihindari (target < 4%)",
    higherIsBetter: false,
  },
  {
    key: "regionalImbalanceResolutionRate",
    label: "Regional Imbalance Resolution",
    description: "seberapa cepat defisit di satu wilayah teratasi",
    higherIsBetter: true,
  },
  {
    key: "averageSafeDeliveredCostPerKg",
    label: "Safe Delivered Cost",
    description: "biaya efektif per kg pangan yang sampai aman",
    higherIsBetter: false,
  },
  {
    key: "averageProcurementPriceDeviationPercent",
    label: "Procurement Price Deviation",
    description: "seberapa jauh harga aktual dari referensi pasar",
    higherIsBetter: false,
  },
  {
    key: "averageDecisionTimeMinutes",
    label: "Decision Time",
    description: "rata-rata waktu dari deteksi defisit sampai rekomendasi siap",
    higherIsBetter: false,
  },
  {
    key: "evidenceCompletenessPercent",
    label: "Evidence Completeness",
    description: "% keputusan dengan bukti lengkap (SAP + IoT + fisik)",
    higherIsBetter: true,
  },
];

/** Format angka KPI sesuai unitnya. */
export function formatKpiValue(key: keyof KPI, value: number): string {
  switch (key) {
    case "avoidableFoodLossKg":
      return formatKg(value);
    case "avoidableFoodLossRp":
      return formatRupiah(value);
    case "averageSafeDeliveredCostPerKg":
      return `${formatRupiah(value)}/kg`;
    case "averageDecisionTimeMinutes":
      return formatMinutes(value);
    default:
      return formatPercent(value);
  }
}

export type TrendDirection = "up" | "down" | "flat";

export interface KpiTrend {
  direction: TrendDirection;
  deltaAbs: number;
  /** Perubahan relatif terhadap periode sebelumnya, dalam persen. */
  deltaPercent: number;
}

/**
 * Bandingkan nilai periode berjalan dengan periode sebelumnya.
 * Kalau histori belum ada (atau pembagi 0), hasilnya "flat" — UI tidak boleh
 * mengarang arah trend.
 */
export function kpiTrend(current: number, previous?: number | null): KpiTrend {
  if (previous === undefined || previous === null || previous === 0) {
    return {
      direction: previous === 0 && current !== 0 ? directionOf(current, 0) : "flat",
      deltaAbs: previous === 0 ? current : 0,
      deltaPercent: 0,
    };
  }

  const deltaAbs = current - previous;
  return {
    direction: directionOf(deltaAbs, 0),
    deltaAbs,
    deltaPercent: Math.round((deltaAbs / previous) * 1000) / 10,
  };
}

function directionOf(delta: number, epsilon: number): TrendDirection {
  if (delta > epsilon) return "up";
  if (delta < -epsilon) return "down";
  return "flat";
}

/**
 * Apakah trend ini membaik? null = tidak berubah / belum ada histori.
 * Dipakai untuk mewarnai KPICard: "naik" belum tentu bagus (food loss naik = buruk).
 */
export function trendIsImprovement(
  definition: KpiDefinition,
  trend: KpiTrend,
): boolean | null {
  if (trend.direction === "flat") return null;
  const goingUp = trend.direction === "up";
  return goingUp === definition.higherIsBetter;
}
