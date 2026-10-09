/**
 * Panel Detail Pemasok — logika murni (`lib/supplier-detail.ts`).
 *
 * Yang dijaga: jumlah batch turunan mock TIDAK mengubah total stok fisik (pembagian batch cuma
 * memecah, bukan menambah), umur panen mock jatuh di pita kesegaran dokumen yang sama dengan
 * backend, dan ringkasan tidak menuduh pemasok lebih buruk dari data (skor NULL diabaikan, bukan
 * dihitung 0).
 */
import { describe, expect, it } from "vitest";

import {
  MOCK_HARVEST_AGE_HOURS,
  SHELF_LIFE_HOURS,
  batchesFromSupply,
  buildMockSupplierDetail,
  latestPriceByCommodity,
  priceSignalsFromSupply,
  summariseSupplierDetail,
} from "./supplier-detail";
import type { Supplier, SupplierDetail, SupplyRecord } from "./api/schema";

const NOW = new Date("2026-10-09T12:00:00.000Z");

const SUPPLIER: Supplier = {
  id: "sup-1",
  name: "Supplier A",
  locationId: "loc-1",
  reliabilityScore: 0.8,
  status: "active",
  excludedAt: null,
  exclusionReason: null,
};

const SUPPLY: SupplyRecord[] = [
  {
    locationId: "loc-1",
    commodityId: "com-telur",
    physicalStockKg: 1000,
    usableStockKg: 950,
    batchCount: 3,
    status: "surplus",
    pricePerKg: 26000,
    freshnessStatus: "fresh",
    safetyStatus: "PASS",
  },
  {
    locationId: "loc-1",
    commodityId: "com-ayam",
    physicalStockKg: 50.5,
    usableStockKg: 0,
    batchCount: 2,
    status: "deficit",
    pricePerKg: 39000,
    freshnessStatus: "expired",
    safetyStatus: "FAIL",
    temperatureExcursion: true,
  },
  // Lokasi lain: tidak boleh ikut masuk detail pemasok ini.
  {
    locationId: "loc-9",
    commodityId: "com-wortel",
    physicalStockKg: 700,
    usableStockKg: 680,
    batchCount: 1,
    status: "surplus",
    pricePerKg: 11500,
    freshnessStatus: "fresh",
    safetyStatus: "PASS",
  },
];

describe("batchesFromSupply (mock)", () => {
  it("memecah stok jadi batchCount batch TANPA mengubah total", () => {
    const batches = batchesFromSupply(SUPPLIER, SUPPLY, NOW);

    expect(batches).toHaveLength(5); // telur 3 batch + ayam 2 batch
    for (const commodity of ["com-telur", "com-ayam"]) {
      const total = batches
        .filter((b) => b.commodityId === commodity)
        .reduce((sum, b) => sum + b.quantityKg, 0);
      const sumber = SUPPLY.find((row) => row.commodityId === commodity)!;
      expect(total).toBeCloseTo(sumber.physicalStockKg, 2);
    }
  });

  it("hanya memakai baris pasokan lokasi pemasok itu", () => {
    const batches = batchesFromSupply(SUPPLIER, SUPPLY, NOW);
    expect(new Set(batches.map((b) => b.locationId))).toEqual(new Set(["loc-1"]));
  });

  it("menurunkan panen dari status kesegaran dan usableUntil = panen + masa layak", () => {
    const batches = batchesFromSupply(SUPPLIER, SUPPLY, NOW);
    const telur = batches.find((b) => b.commodityId === "com-telur")!;
    const ayam = batches.find((b) => b.commodityId === "com-ayam")!;

    expect(MOCK_HARVEST_AGE_HOURS.fresh).toBeLessThan(MOCK_HARVEST_AGE_HOURS.expired);
    const selisihTelur =
      (NOW.getTime() - new Date(telur.harvestedAt).getTime()) / (60 * 60 * 1000);
    expect(selisihTelur).toBe(MOCK_HARVEST_AGE_HOURS.fresh);
    for (const batch of [telur, ayam]) {
      const masa = (new Date(batch.usableUntil).getTime() - new Date(batch.harvestedAt).getTime()) / 3_600_000;
      expect(masa).toBe(SHELF_LIFE_HOURS);
    }
    // Skor mock tetap di pita dokumen yang sama dengan kata statusnya.
    expect(telur.freshnessScore).toBeGreaterThanOrEqual(0.85);
    expect(ayam.freshnessScore).toBeLessThan(0.6);
    expect(ayam.temperatureExcursion).toBe(true);
  });
});

describe("priceSignalsFromSupply (mock)", () => {
  it("satu kuotasi per komoditas lokasi itu, sumbernya supplier_quote", () => {
    const signals = priceSignalsFromSupply(SUPPLIER, SUPPLY, NOW);

    expect(signals.map((s) => s.commodityId).sort()).toEqual(["com-ayam", "com-telur"]);
    expect(new Set(signals.map((s) => s.source))).toEqual(new Set(["supplier_quote"]));
    expect(signals[0].pricePerKg).toBeGreaterThan(0);
  });
});

describe("summariseSupplierDetail", () => {
  const detail: SupplierDetail = {
    supplier: SUPPLIER,
    batches: batchesFromSupply(SUPPLIER, SUPPLY, NOW),
    priceSignals: priceSignalsFromSupply(SUPPLIER, SUPPLY, NOW),
    purchaseOrders: [
      {
        poNumber: "4500001234",
        materialNumber: "MOCK",
        orderedQuantityKg: 700,
        price: 0,
        status: "submitted",
        decisionId: "dec-1",
        createdAt: NOW.toISOString(),
      },
    ],
    exclusionDecisions: [
      {
        decisionId: "dec-2",
        status: "pending_approval",
        reason: "Dua pengiriman gagal inspeksi.",
        createdAt: NOW.toISOString(),
      },
      {
        decisionId: "dec-3",
        status: "rejected",
        reason: "Bukti kurang.",
        createdAt: NOW.toISOString(),
      },
    ],
  };

  it("menghitung batch, total kg, dan masalah keselamatan", () => {
    const ringkas = summariseSupplierDetail(detail);

    expect(ringkas.batchCount).toBe(5);
    expect(ringkas.totalQuantityKg).toBeCloseTo(1050.5, 2);
    expect(ringkas.purchaseOrderCount).toBe(1);
    expect(ringkas.safetyIssueCount).toBe(2); // 2 batch ayam FAIL
    expect(ringkas.excursionCount).toBe(2);
  });

  it("skor terendah mengabaikan batch yang skornya belum ada", () => {
    const tanpaSkor: SupplierDetail = {
      ...detail,
      batches: detail.batches.map((batch) => ({ ...batch, freshnessScore: null })),
    };

    expect(summariseSupplierDetail(tanpaSkor).lowestFreshnessScore).toBeNull();
    expect(summariseSupplierDetail(detail).lowestFreshnessScore).toBe(0.3);
  });

  it("usulan eksklusi yang belum selesai dihitung; yang ditolak tidak", () => {
    expect(summariseSupplierDetail(detail).openExclusionCount).toBe(1);
  });
});

describe("latestPriceByCommodity", () => {
  it("mengambil kuotasi terbaru per komoditas", () => {
    const hasil = latestPriceByCommodity([
      {
        commodityId: "com-telur",
        pricePerKg: 25000,
        source: "supplier_quote",
        recordedAt: "2026-10-08T00:00:00.000Z",
      },
      {
        commodityId: "com-telur",
        pricePerKg: 27000,
        source: "supplier_quote",
        recordedAt: "2026-10-09T00:00:00.000Z",
      },
      {
        commodityId: "com-ayam",
        pricePerKg: 39000,
        source: "supplier_quote",
        recordedAt: "2026-10-07T00:00:00.000Z",
      },
    ]);

    expect(hasil).toHaveLength(2);
    expect(hasil.find((s) => s.commodityId === "com-telur")!.pricePerKg).toBe(27000);
  });
});

describe("buildMockSupplierDetail", () => {
  it("mengumpulkan PO bersumber lokasi pemasok dan riwayat eksklusi pemasok itu saja", () => {
    const detail = buildMockSupplierDetail(
      SUPPLIER,
      SUPPLY,
      [
        {
          id: "dec-po-1",
          status: "executed",
          sourceLocationId: "loc-1",
          createdAt: NOW.toISOString(),
          sapPurchaseOrder: {
            poNumber: "4500001234",
            plant: "loc-1",
            orderedQuantityKg: 200,
            status: "confirmed",
          },
        },
        {
          id: "dec-po-lain",
          status: "executed",
          sourceLocationId: "loc-9",
          createdAt: NOW.toISOString(),
          sapPurchaseOrder: {
            poNumber: "4500009999",
            plant: "loc-9",
            orderedQuantityKg: 100,
            status: "confirmed",
          },
        },
        {
          id: "dec-excl",
          status: "executed",
          sourceLocationId: "loc-1",
          supplierId: "sup-1",
          exclusionReason: "Gagal inspeksi.",
          createdAt: NOW.toISOString(),
        },
        {
          id: "dec-excl-lain",
          status: "executed",
          sourceLocationId: "loc-3",
          supplierId: "sup-3",
          exclusionReason: "Pemasok lain.",
          createdAt: NOW.toISOString(),
        },
      ],
      NOW,
    );

    expect(detail.purchaseOrders.map((po) => po.poNumber)).toEqual(["4500001234"]);
    expect(detail.exclusionDecisions.map((d) => d.decisionId)).toEqual(["dec-excl"]);
    expect(detail.supplier).toBe(SUPPLIER);
    expect(detail.batches).toHaveLength(5);
  });
});
