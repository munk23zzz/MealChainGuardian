import { describe, it, expect } from "vitest";
import {
  commodityLabel,
  commodityLinesForLocation,
  locationLabel,
  locationSupplySummaries,
  recommendationsForLocation,
  shortLocationLabel,
  worstSupplyStatus,
} from "./labels";
import type { Commodity, Location, Recommendation, SupplyRecord } from "./api/schema";

const locations: Location[] = [
  { id: "loc-1", name: "SPPG Jakarta Pusat", region: "DKI Jakarta", latitude: -6.18, longitude: 106.83, status: "ok" },
  { id: "loc-2", name: "SPPG Jakarta Utara", region: "DKI Jakarta", latitude: -6.12, longitude: 106.9, status: "warning" },
];

const commodities: Commodity[] = [
  { id: "com-telur", name: "telur", unit: "kg" },
  { id: "com-ayam", name: "ayam", unit: "kg" },
];

const supply: SupplyRecord[] = [
  { locationId: "loc-1", commodityId: "com-telur", physicalStockKg: 100, usableStockKg: 90, batchCount: 1, status: "surplus", pricePerKg: 25000, freshnessStatus: "fresh", safetyStatus: "PASS" },
  { locationId: "loc-1", commodityId: "com-ayam", physicalStockKg: 50, usableStockKg: 40, batchCount: 1, status: "deficit", pricePerKg: 35000, freshnessStatus: "fresh", safetyStatus: "PASS" },
  { locationId: "loc-2", commodityId: "com-telur", physicalStockKg: 20, usableStockKg: 20, batchCount: 1, status: "balanced", pricePerKg: 29000, freshnessStatus: "fresh", safetyStatus: "PASS" },
];

describe("commodityLabel / locationLabel", () => {
  it("memakai nama dari backend kalau ada (huruf awal dibesarkan)", () => {
    expect(commodityLabel("com-telur", commodities)).toBe("Telur");
  });

  it("fallback ke map statis, lalu ke id apa adanya — tidak mengarang nama", () => {
    expect(commodityLabel("com-wortel")).toBe("Wortel");
    expect(commodityLabel("com-tidak-ada")).toBe("com-tidak-ada");
  });

  it("nama lokasi dari data, fallback ke id", () => {
    expect(locationLabel("loc-2", locations)).toBe("SPPG Jakarta Utara");
    expect(locationLabel("loc-99", locations)).toBe("loc-99");
  });

  it("nama pendek membuang prefiks jenis lokasi untuk sumbu chart", () => {
    expect(shortLocationLabel("SPPG Jakarta Utara")).toBe("Jakarta Utara");
    expect(shortLocationLabel("Gudang Cianjur")).toBe("Cianjur");
    expect(shortLocationLabel("Jakarta Pusat")).toBe("Jakarta Pusat");
  });
});

describe("worstSupplyStatus", () => {
  it("defisit mengalahkan balanced/surplus (status terburuk untuk pewarnaan)", () => {
    expect(worstSupplyStatus(["surplus", "balanced", "deficit"])).toBe("deficit");
    expect(worstSupplyStatus(["surplus", "balanced"])).toBe("balanced");
  });

  it("null kalau tidak ada data (jangan diam-diam dianggap aman)", () => {
    expect(worstSupplyStatus([])).toBeNull();
  });
});

describe("commodityLinesForLocation", () => {
  it("hanya baris milik lokasi itu, dengan label siap tampil", () => {
    const lines = commodityLinesForLocation("loc-1", supply, commodities);
    expect(lines.map((l) => l.label)).toEqual(["Telur", "Ayam"]);
    expect(lines.map((l) => l.status)).toEqual(["surplus", "deficit"]);
  });
});

describe("locationSupplySummaries", () => {
  it("satu ringkasan per lokasi, urut seperti daftar lokasi", () => {
    const summaries = locationSupplySummaries(locations, supply, commodities);
    expect(summaries.map((s) => s.locationId)).toEqual(["loc-1", "loc-2"]);
    expect(summaries[0].worstStatus).toBe("deficit");
    expect(summaries[1].worstStatus).toBe("balanced");
  });

  it("lokasi tanpa data tetap muncul dengan lines kosong", () => {
    const summaries = locationSupplySummaries(locations, [], commodities);
    expect(summaries[0].lines).toEqual([]);
    expect(summaries[0].worstStatus).toBeNull();
  });
});

describe("recommendationsForLocation", () => {
  const rec = {
    id: "dec-1",
    status: "pending_approval",
    decisionType: "regional_balance",
    sourceLocationId: "loc-1",
    targetLocationId: "loc-2",
    commodityId: "com-telur",
    quantityKg: 10,
    safetyCheck: "PASS",
    reason: "",
    createdAt: "2026-09-24T10:00:00.000Z",
    evidence: { sap: true, iot: true, physical: true, completenessPercent: 100, inconsistencies: [] },
    safeDeliveredCostBreakdown: [],
  } as Recommendation;

  it("mengambil keputusan yang menyentuh lokasi itu (sumber atau tujuan)", () => {
    expect(recommendationsForLocation([rec], "loc-1")).toHaveLength(1);
    expect(recommendationsForLocation([rec], "loc-2")).toHaveLength(1);
    expect(recommendationsForLocation([rec], "loc-3")).toHaveLength(0);
  });
});
