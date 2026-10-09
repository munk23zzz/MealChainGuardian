import { describe, it, expect } from "vitest";
import {
  decisionTouchesScope,
  isLocationInScope,
  partitionByScope,
  scopeDescription,
  scopeLabel,
} from "./scope";
import type { DataScope } from "./role";
import type { Recommendation } from "./api/schema";

/**
 * Penyaring data per cakupan peran (design.md §1.4). Aturan penting: data di luar
 * cakupan TIDAK dihapus diam-diam — selalu dikembalikan terpisah supaya UI bisa
 * memberi tahu jumlahnya.
 */

const locations = [
  { id: "loc-2", name: "SPPG Jakarta Utara", region: "DKI Jakarta" },
  { id: "loc-5", name: "SPPG Jakarta Timur", region: "DKI Jakarta" },
  { id: "loc-6", name: "SPPG Bogor", region: "Jawa Barat" },
  { id: "loc-10", name: "Gudang Cianjur", region: "Jawa Barat" },
];

const decision = (over: Partial<Recommendation> = {}): Recommendation =>
  ({
    id: "dec-x",
    status: "pending_approval",
    decisionType: "regional_balance",
    sourceLocationId: "loc-10",
    targetLocationId: "loc-2",
    commodityId: "com-telur",
    quantityKg: 100,
    safeDeliveredCostBreakdown: [],
    evidence: { completenessPercent: 90, itemCount: 1, inconsistentCount: 0 },
    safetyCheck: "PASS",
    reason: "-",
    createdAt: "2026-10-07T00:00:00.000Z",
    ...over,
  }) as Recommendation;

describe("scopeLabel", () => {
  it("memberi label manusiawi untuk tiap jenis cakupan", () => {
    expect(scopeLabel({ kind: "all" })).toBe("semua wilayah");
    expect(scopeLabel({ kind: "region", region: "DKI Jakarta" })).toBe("DKI Jakarta");
    expect(scopeLabel({ kind: "location", locationId: "loc-5" })).toBe("lokasi sendiri");
  });
});

describe("isLocationInScope", () => {
  it("cakupan 'all' menerima semua lokasi", () => {
    expect(isLocationInScope("loc-6", { kind: "all" }, locations)).toBe(true);
  });

  it("cakupan wilayah hanya menerima lokasi di wilayah itu", () => {
    const scope: DataScope = { kind: "region", region: "DKI Jakarta" };
    expect(isLocationInScope("loc-2", scope, locations)).toBe(true);
    expect(isLocationInScope("loc-6", scope, locations)).toBe(false);
  });

  it("cakupan lokasi hanya menerima lokasi itu", () => {
    const scope: DataScope = { kind: "location", locationId: "loc-5" };
    expect(isLocationInScope("loc-5", scope, locations)).toBe(true);
    expect(isLocationInScope("loc-2", scope, locations)).toBe(false);
  });

  it("lokasi tak dikenal pada cakupan wilayah/lokasi → di luar cakupan", () => {
    expect(
      isLocationInScope("loc-999", { kind: "region", region: "DKI Jakarta" }, locations),
    ).toBe(false);
  });
});

describe("decisionTouchesScope", () => {
  it("keputusan yang menyentuh wilayah peran tetap terlihat", () => {
    // Cianjur (Jawa Barat) → Jakarta Utara (DKI): bagi peran Jawa Barat, asalnya ada di wilayahnya.
    expect(
      decisionTouchesScope(decision(), { kind: "region", region: "Jawa Barat" }, locations),
    ).toBe(true);
  });

  it("keputusan yang sama sekali di luar wilayah peran disembunyikan", () => {
    const jauh = decision({ sourceLocationId: "loc-10", targetLocationId: "loc-6" });
    expect(
      decisionTouchesScope(jauh, { kind: "region", region: "Banten" }, locations),
    ).toBe(false);
  });

  it("peran satu lokasi hanya melihat keputusan yang menyentuh lokasinya", () => {
    const scope: DataScope = { kind: "location", locationId: "loc-2" };
    expect(decisionTouchesScope(decision(), scope, locations)).toBe(true);
    expect(
      decisionTouchesScope(
        decision({ sourceLocationId: "loc-6", targetLocationId: "loc-5" }),
        scope,
        locations,
      ),
    ).toBe(false);
  });

  it("cakupan 'all' menerima semua keputusan", () => {
    expect(decisionTouchesScope(decision(), { kind: "all" }, locations)).toBe(true);
  });
});

describe("partitionByScope", () => {
  it("mengembalikan dua kelompok, bukan hanya yang cocok", () => {
    const items = [
      decision({ id: "a", targetLocationId: "loc-2" }),
      decision({ id: "b", targetLocationId: "loc-6", sourceLocationId: "loc-6" }),
    ];
    const { inScope, outOfScope } = partitionByScope(items, (d) =>
      decisionTouchesScope(d, { kind: "region", region: "DKI Jakarta" }, locations),
    );
    expect(inScope.map((d) => d.id)).toEqual(["a"]);
    expect(outOfScope.map((d) => d.id)).toEqual(["b"]);
  });

  it("daftar kosong tidak error", () => {
    expect(partitionByScope([], () => true)).toEqual({ inScope: [], outOfScope: [] });
  });
});

describe("scopeDescription", () => {
  it("menjelaskan cakupan + jumlah data di luar cakupan", () => {
    expect(scopeDescription({ kind: "all" }, 3)).toBe("menampilkan semua wilayah");
    expect(scopeDescription({ kind: "region", region: "DKI Jakarta" }, 0)).toBe(
      "menampilkan wilayah DKI Jakarta",
    );
    expect(scopeDescription({ kind: "region", region: "DKI Jakarta" }, 2)).toBe(
      "menampilkan wilayah DKI Jakarta · 2 di luar wilayah Anda",
    );
  });
});
