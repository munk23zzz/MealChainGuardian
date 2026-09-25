import { describe, it, expect } from "vitest";
import {
  buildCandidateCostChartData,
  buildSupplyDemandChartData,
} from "./chart-data";
import type { SupplyRecord } from "./api/schema";

const baseSupply: SupplyRecord = {
  locationId: "jakarta",
  commodityId: "telur",
  physicalStockKg: 1000,
  usableStockKg: 900,
  batchCount: 5,
  status: "deficit",
  pricePerKg: 25000,
  freshnessStatus: "fresh",
  safetyStatus: "PASS",
};

describe("buildCandidateCostChartData", () => {
  it("mengambil supplierId dan total biaya per kandidat", () => {
    const data = buildCandidateCostChartData([
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
    ]);
    expect(data).toEqual([
      { name: "bogor", totalSafeDeliveredCostPerKg: 27450 },
      { name: "cianjur", totalSafeDeliveredCostPerKg: 27000 },
    ]);
  });

  it("mengembalikan array kosong untuk input kosong", () => {
    expect(buildCandidateCostChartData([])).toEqual([]);
  });
});

describe("buildSupplyDemandChartData", () => {
  it("menjumlahkan usableStockKg per lokasi (supply)", () => {
    const supplies = [
      { ...baseSupply, locationId: "jakarta", usableStockKg: 900 },
      { ...baseSupply, locationId: "jakarta", commodityId: "ayam", usableStockKg: 500 },
      { ...baseSupply, locationId: "bogor", usableStockKg: 2000 },
    ];
    const data = buildSupplyDemandChartData(supplies);
    expect(data).toEqual([
      { name: "jakarta", supply: 1400 },
      { name: "bogor", supply: 2000 },
    ]);
  });

  it("mengembalikan array kosong untuk input kosong", () => {
    expect(buildSupplyDemandChartData([])).toEqual([]);
  });
});
