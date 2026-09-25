import { describe, it, expect } from "vitest";
import {
  CONSTRAINT_LABELS,
  summarizeConstraints,
  sortRecommendationsByUrgency,
  urgencyLabel,
  urgencyTier,
} from "./urgency";
import type { Recommendation } from "./api/schema";

/**
 * design.md §3.2: feed diurutkan berdasarkan urgensi
 * (safety issue > regional imbalance > price anomaly).
 */
const base: Recommendation = {
  id: "dec-x",
  status: "pending_approval",
  decisionType: "regional_balance",
  sourceLocationId: "loc-1",
  targetLocationId: "loc-2",
  commodityId: "com-telur",
  quantityKg: 200,
  safetyCheck: "PASS",
  reason: "test",
  createdAt: "2026-09-24T10:00:00.000Z",
  evidence: { sap: true, iot: true, physical: true, completenessPercent: 100, inconsistencies: [] },
  safeDeliveredCostBreakdown: [],
};

describe("urgencyTier", () => {
  it("isu keamanan paling mendesak (tier 0)", () => {
    expect(urgencyTier({ ...base, safetyCheck: "FAIL" })).toBe(0);
    expect(urgencyTier({ ...base, safetyCheck: "NEEDS_VERIFICATION" })).toBe(0);
    expect(urgencyTier({ ...base, decisionType: "safety_disruption" })).toBe(0);
  });

  it("ketidakseimbangan regional di tengah (tier 1)", () => {
    expect(urgencyTier({ ...base, decisionType: "regional_balance" })).toBe(1);
  });

  it("anomali harga paling akhir (tier 2)", () => {
    expect(urgencyTier({ ...base, decisionType: "price_anomaly" })).toBe(2);
  });

  it("keputusan keamanan tetap tier 0 walau tipenya bukan safety_disruption", () => {
    expect(
      urgencyTier({ ...base, safetyCheck: "FAIL", decisionType: "regional_balance" }),
    ).toBe(0);
  });
});

describe("urgencyLabel", () => {
  it("memberi label yang bisa dibaca di card feed", () => {
    expect(urgencyLabel({ ...base, decisionType: "safety_disruption" })).toBe(
      "Isu keamanan",
    );
    expect(urgencyLabel({ ...base, decisionType: "regional_balance" })).toBe(
      "Ketidakseimbangan regional",
    );
    expect(urgencyLabel({ ...base, decisionType: "price_anomaly" })).toBe(
      "Anomali harga",
    );
  });
});

describe("sortRecommendationsByUrgency", () => {
  it("mengurutkan tier lebih dulu, lalu terbaru di dalam tier yang sama", () => {
    const olderSafety = {
      ...base,
      id: "a",
      decisionType: "safety_disruption" as const,
      createdAt: "2026-09-24T08:00:00.000Z",
    };
    const newerSafety = { ...olderSafety, id: "b", createdAt: "2026-09-24T09:00:00.000Z" };
    const regional = {
      ...base,
      id: "c",
      decisionType: "regional_balance" as const,
      createdAt: "2026-09-24T11:00:00.000Z",
    };
    const price = {
      ...base,
      id: "d",
      decisionType: "price_anomaly" as const,
      createdAt: "2026-09-24T12:00:00.000Z",
    };

    expect(
      sortRecommendationsByUrgency([price, regional, olderSafety, newerSafety]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "a", "c", "d"]);
  });

  it("tidak mengubah array masukan (pure)", () => {
    const list = [{ ...base, id: "a" }, { ...base, id: "b", decisionType: "price_anomaly" as const }];
    const before = list.map((r) => r.id);
    sortRecommendationsByUrgency(list);
    expect(list.map((r) => r.id)).toEqual(before);
  });
});

describe("summarizeConstraints", () => {
  it("menghitung lolos/gagal dan hanya 'semua lolos' kalau memang ada datanya", () => {
    expect(
      summarizeConstraints([
        { name: "safety_eligibility", passed: true },
        { name: "freshness_threshold", passed: true },
        { name: "capacity", passed: true },
        { name: "delivery_window", passed: false },
      ]),
    ).toEqual({ passed: 3, failed: 1, total: 4, allPassed: false });
  });

  it("data constraint belum tersedia bukan berarti aman", () => {
    expect(summarizeConstraints(undefined)).toEqual({
      passed: 0,
      failed: 0,
      total: 0,
      allPassed: false,
    });
  });
});

describe("CONSTRAINT_LABELS", () => {
  it("memakai istilah design.md §3.3 dalam Bahasa Indonesia", () => {
    const labels = Object.values(CONSTRAINT_LABELS).join(" | ").toLowerCase();
    expect(labels).toContain("keamanan");
    expect(labels).toContain("kesegaran");
    expect(labels).toContain("kapasitas");
    expect(labels).toContain("pengiriman");
  });
});
