import { describe, it, expect } from "vitest";
import { deriveLocationStatus, splitSurplusDeficit } from "./status";
import type { SupplyRecord } from "./api/schema";

const baseSupply: SupplyRecord = {
  locationId: "jakarta",
  commodityId: "telur",
  physicalStockKg: 1000,
  usableStockKg: 900,
  batchCount: 5,
  status: "balanced",
  pricePerKg: 25000,
  freshnessStatus: "fresh",
  safetyStatus: "PASS",
};

describe("deriveLocationStatus", () => {
  it("ok jika semua supply aman dan balanced", () => {
    expect(deriveLocationStatus([baseSupply])).toBe("ok");
  });

  it("critical jika ada safety FAIL", () => {
    expect(
      deriveLocationStatus([{ ...baseSupply, safetyStatus: "FAIL" }]),
    ).toBe("critical");
  });

  it("critical jika ada temperature excursion", () => {
    expect(
      deriveLocationStatus([{ ...baseSupply, temperatureExcursion: true }]),
    ).toBe("critical");
  });

  it("warning jika ada deficit", () => {
    expect(
      deriveLocationStatus([{ ...baseSupply, status: "deficit" }]),
    ).toBe("warning");
  });

  it("warning jika freshness mendekati expired", () => {
    expect(
      deriveLocationStatus([
        { ...baseSupply, freshnessStatus: "approaching_expiry" },
      ]),
    ).toBe("warning");
  });

  it("critical mengalahkan warning", () => {
    expect(
      deriveLocationStatus([
        { ...baseSupply, status: "deficit", safetyStatus: "FAIL" },
      ]),
    ).toBe("critical");
  });

  it("ok untuk list kosong", () => {
    expect(deriveLocationStatus([])).toBe("ok");
  });
});

describe("splitSurplusDeficit", () => {
  it("memisahkan surplus dan deficit berdasarkan status", () => {
    const surplus = { ...baseSupply, locationId: "cianjur", status: "surplus" as const };
    const deficit = { ...baseSupply, locationId: "jakarta", status: "deficit" as const };
    const result = splitSurplusDeficit([surplus, deficit, baseSupply]);
    expect(result.surplus.map((s) => s.locationId)).toEqual(["cianjur"]);
    expect(result.deficit.map((s) => s.locationId)).toEqual(["jakarta"]);
  });

  it("mengembalikan list kosong jika tidak ada", () => {
    const result = splitSurplusDeficit([baseSupply]);
    expect(result.surplus).toEqual([]);
    expect(result.deficit).toEqual([]);
  });
});
