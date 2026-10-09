import { describe, it, expect } from "vitest";
import {
  KPI_DEFINITIONS,
  formatKpiValue,
  kpiLabel,
  kpiTrend,
  trendIsImprovement,
} from "./kpi";

/**
 * design.md §3.6: 7 KPI card, masing-masing angka besar + trend kecil
 * (naik/turun vs periode sebelumnya kalau ada histori).
 */
describe("KPI_DEFINITIONS", () => {
  it("berisi tepat 7 KPI sesuai design.md §3.6 (urutan sama)", () => {
    expect(KPI_DEFINITIONS).toHaveLength(7);
    expect(KPI_DEFINITIONS.map((d) => d.key)).toEqual([
      "mealContinuityRate",
      "avoidableFoodLossKg",
      "regionalImbalanceResolutionRate",
      "averageSafeDeliveredCostPerKg",
      "averageProcurementPriceDeviationPercent",
      "averageDecisionTimeMinutes",
      "evidenceCompletenessPercent",
    ]);
  });

  it("setiap KPI punya label dan penjelasan (tidak ada card tanpa konteks)", () => {
    for (const def of KPI_DEFINITIONS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(typeof def.higherIsBetter).toBe("boolean");
    }
  });
});

describe("trendIsImprovement", () => {
  const continuity = KPI_DEFINITIONS.find((d) => d.key === "mealContinuityRate")!;
  const foodLoss = KPI_DEFINITIONS.find((d) => d.key === "avoidableFoodLossKg")!;

  it("naik di KPI 'makin besar makin baik' = membaik", () => {
    expect(trendIsImprovement(continuity, kpiTrend(95, 90))).toBe(true);
  });

  it("naik di KPI 'makin kecil makin baik' = memburuk", () => {
    expect(trendIsImprovement(foodLoss, kpiTrend(400, 320))).toBe(false);
  });

  it("turun di KPI 'makin kecil makin baik' = membaik", () => {
    expect(trendIsImprovement(foodLoss, kpiTrend(280, 320))).toBe(true);
  });

  it("flat = tidak ada penilaian (null), bukan diam-diam dianggap baik", () => {
    expect(trendIsImprovement(continuity, kpiTrend(90, 90))).toBeNull();
  });
});

describe("formatKpiValue", () => {
  it("memformat persen, kg, rupiah/kg, dan menit sesuai unitnya", () => {
    expect(formatKpiValue("mealContinuityRate", 94.7)).toBe("94,7%");
    expect(formatKpiValue("avoidableFoodLossKg", 320)).toBe("320 kg");
    expect(formatKpiValue("averageSafeDeliveredCostPerKg", 27500)).toBe(
      "Rp 27.500/kg",
    );
    expect(formatKpiValue("averageDecisionTimeMinutes", 18)).toBe("18 menit");
  });

  it("tampil '—' kalau KPI belum bisa dihitung (bukan 0 yang terbaca seperti nol kejadian)", () => {
    expect(formatKpiValue("mealContinuityRate", null)).toBe("—");
    expect(formatKpiValue("avoidableFoodLossKg", undefined)).toBe("—");
    expect(formatKpiValue("avoidableFoodLossRp", Number.NaN)).toBe("—");
  });
});

describe("kpiLabel", () => {
  it("memberi label untuk KPI yang tidak punya card sendiri (nilai rupiah food loss)", () => {
    expect(kpiLabel("avoidableFoodLossRp")).toBe("Avoidable Food Loss (nilai Rp)");
    expect(kpiLabel("mealContinuityRate")).toBe("Meal Continuity Rate");
  });
});

describe("kpiTrend", () => {
  it("naik kalau nilai sekarang lebih besar", () => {
    const trend = kpiTrend(94.7, 90);
    expect(trend.direction).toBe("up");
    expect(trend.deltaAbs).toBeCloseTo(4.7);
    expect(trend.deltaPercent).toBeCloseTo(5.2, 1);
  });

  it("turun kalau nilai sekarang lebih kecil", () => {
    const trend = kpiTrend(88, 96);
    expect(trend.direction).toBe("down");
    expect(trend.deltaAbs).toBeCloseTo(-8);
  });

  it("flat kalau sama", () => {
    expect(kpiTrend(90, 90).direction).toBe("flat");
  });

  it("flat kalau belum ada histori (periode sebelumnya belum tersedia)", () => {
    const trend = kpiTrend(90, undefined);
    expect(trend.direction).toBe("flat");
    expect(trend.deltaAbs).toBe(0);
    expect(trend.deltaPercent).toBe(0);
  });

  it("flat kalau KPI belum bisa dihitung (nilai kosong) — trend tidak dikarang", () => {
    for (const current of [null, undefined, Number.NaN]) {
      const trend = kpiTrend(current, 90);
      expect(trend.direction).toBe("flat");
      expect(trend.deltaAbs).toBe(0);
    }
  });

  it("tidak meledak saat nilai sebelumnya 0 (tidak bagi nol)", () => {
    const trend = kpiTrend(5, 0);
    expect(trend.direction).toBe("up");
    expect(Number.isFinite(trend.deltaPercent)).toBe(true);
    expect(trend.deltaPercent).toBe(0);
  });
});
