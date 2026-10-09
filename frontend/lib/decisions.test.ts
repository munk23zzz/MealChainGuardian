import { describe, it, expect } from "vitest";
import {
  filterRecommendations,
  sortRecommendationsNewestFirst,
  getWinningCandidate,
  targetRegion,
} from "./decisions";
import type { Location, Recommendation } from "./api/schema";

const base: Recommendation = {
  id: "d1",
  status: "pending_approval",
  decisionType: "regional_balance",
  sourceLocationId: "cianjur",
  targetLocationId: "jakarta",
  commodityId: "telur",
  quantityKg: 2000,
  safeDeliveredCostBreakdown: [
    {
      candidateId: "c1",
      supplierId: "bogor",
      pricePerKg: 27000,
      transportCostPerKg: 300,
      handlingCostPerKg: 100,
      spoilageRiskCostPerKg: 50,
      safetyPenaltyPerKg: 0,
      totalSafeDeliveredCostPerKg: 27450,
      distanceKm: 80,
      etaMinutes: 120,
      evidenceCompleteness: 100,
    },
    {
      candidateId: "c2",
      supplierId: "cianjur",
      pricePerKg: 25000,
      transportCostPerKg: 1200,
      handlingCostPerKg: 100,
      spoilageRiskCostPerKg: 200,
      safetyPenaltyPerKg: 500,
      totalSafeDeliveredCostPerKg: 27000,
      distanceKm: 150,
      etaMinutes: 200,
      evidenceCompleteness: 60,
    },
  ],
  evidence: {
    sap: true,
    iot: true,
    physical: true,
    completenessPercent: 100,
    inconsistencies: [],
  },
  safetyCheck: "PASS",
  reason: "Bogor lebih murah total",
  createdAt: "2026-09-01T08:00:00Z",
};

describe("filterRecommendations", () => {
  it("filter berdasarkan status", () => {
    const approved = { ...base, id: "d2", status: "approved" as const };
    const result = filterRecommendations([base, approved], "approved");
    expect(result.map((r) => r.id)).toEqual(["d2"]);
  });

  it("tanpa status -> semua", () => {
    const approved = { ...base, id: "d2", status: "approved" as const };
    expect(filterRecommendations([base, approved]).length).toBe(2);
  });
});

describe("sortRecommendationsNewestFirst", () => {
  it("urutkan terbaru dulu", () => {
    const older = { ...base, id: "old", createdAt: "2026-09-01T08:00:00Z" };
    const newer = { ...base, id: "new", createdAt: "2026-09-02T08:00:00Z" };
    const result = sortRecommendationsNewestFirst([older, newer]);
    expect(result.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("getWinningCandidate", () => {
  it("mengembalikan kandidat dengan total biaya terendah", () => {
    const winner = getWinningCandidate(base);
    expect(winner?.supplierId).toBe("cianjur");
  });

  it("null jika breakdown kosong", () => {
    expect(getWinningCandidate({ ...base, safeDeliveredCostBreakdown: [] })).toBeNull();
  });
});

const locations: Location[] = [
  {
    id: "jakarta",
    name: "SPPG Jakarta Utara",
    region: "DKI Jakarta",
    latitude: -6.1218,
    longitude: 106.9,
    roleHint: "demand_hub",
    status: "warning",
  },
];

describe("targetRegion", () => {
  it("mengembalikan region lokasi tujuan (dasar cek scope approval)", () => {
    expect(targetRegion(base, locations)).toBe("DKI Jakarta");
  });

  it("undefined bila lokasi tujuan tidak ada — izin approve gagal-tertutup", () => {
    expect(
      targetRegion({ ...base, targetLocationId: "tidak-ada" }, locations),
    ).toBeUndefined();
  });

  it("tidak memakai region lokasi sumber sebagai tebakan", () => {
    const sumberJakarta = locations[0];
    expect(sumberJakarta.region).toBe("DKI Jakarta");
    expect(
      targetRegion({ ...base, targetLocationId: "tidak-ada" }, locations),
    ).not.toBe(sumberJakarta.region);
  });
});
