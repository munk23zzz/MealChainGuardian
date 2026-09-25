import { describe, it, expect } from "vitest";
import {
  COST_COMPONENT_LABELS,
  buildCostRows,
  costTotalMatches,
  sumCostRows,
} from "./cost";
import type { CandidateCostBreakdown } from "./api/schema";

/**
 * design.md §3.3: Decision Detail WAJIB menampilkan breakdown
 * purchase+transport+handling+expected loss+freshness risk+safety penalty = total.
 * Kalau komponennya beda dari total di backend, itu sinyal data tidak konsisten —
 * harus kelihatan, bukan disembunyikan.
 */
const candidate: CandidateCostBreakdown = {
  candidateId: "cand-1",
  supplierId: "loc-1",
  pricePerKg: 28000,
  transportCostPerKg: 1500,
  handlingCostPerKg: 500,
  spoilageRiskCostPerKg: 200,
  freshnessRiskCostPerKg: 100,
  safetyPenaltyPerKg: 0,
  totalSafeDeliveredCostPerKg: 30300,
  distanceKm: 12,
  etaMinutes: 45,
  evidenceCompleteness: 95,
};

describe("buildCostRows", () => {
  it("menghasilkan 6 komponen sesuai urutan design.md §3.3", () => {
    const rows = buildCostRows(candidate);
    expect(rows.map((r) => r.key)).toEqual([
      "purchase",
      "transport",
      "handling",
      "expected_loss",
      "freshness_risk",
      "safety_penalty",
    ]);
    expect(rows.map((r) => r.amountPerKg)).toEqual([
      28000, 1500, 500, 200, 100, 0,
    ]);
  });

  it("tiap komponen punya label Bahasa Indonesia yang jelas", () => {
    expect(COST_COMPONENT_LABELS.purchase).toBe("Harga beli");
    expect(COST_COMPONENT_LABELS.expected_loss).toContain("susut");
    expect(COST_COMPONENT_LABELS.freshness_risk).toBe("Freshness risk");
    expect(COST_COMPONENT_LABELS.safety_penalty).toBe("Safety penalty");
  });

  it("freshness risk yang tidak dikirim backend jadi 0 dan ditandai hilang", () => {
    const rows = buildCostRows({
      ...candidate,
      freshnessRiskCostPerKg: undefined,
      totalSafeDeliveredCostPerKg: 30200,
    });
    const freshness = rows.find((r) => r.key === "freshness_risk");
    expect(freshness?.amountPerKg).toBe(0);
    expect(freshness?.missing).toBe(true);
  });
});

describe("sumCostRows", () => {
  it("menjumlahkan semua komponen", () => {
    expect(sumCostRows(buildCostRows(candidate))).toBe(30300);
  });
});

describe("costTotalMatches", () => {
  it("true kalau jumlah komponen = total backend", () => {
    expect(costTotalMatches(candidate)).toBe(true);
  });

  it("false kalau total backend tidak sama dengan jumlah komponen", () => {
    expect(
      costTotalMatches({ ...candidate, totalSafeDeliveredCostPerKg: 31000 }),
    ).toBe(false);
  });

  it("toleran terhadap pembulatan di bawah 1 sen", () => {
    expect(
      costTotalMatches({ ...candidate, totalSafeDeliveredCostPerKg: 30300.004 }),
    ).toBe(true);
  });
});
