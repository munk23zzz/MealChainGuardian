import { describe, expect, it } from "vitest";
import type { Supplier } from "@/lib/api/schema";
import {
  RELIABILITY_THRESHOLD,
  filterSuppliers,
  isSupplierFilterActive,
} from "./supplier-filter";

function supplier(over: Partial<Supplier> & { id: string }): Supplier {
  return {
    name: `Pemasok ${over.id}`,
    locationId: "loc-1",
    reliabilityScore: 0.9,
    status: "active",
    ...over,
  } as Supplier;
}

const LIST: Supplier[] = [
  supplier({ id: "SUP-001", name: "Koperasi Cianjur", reliabilityScore: 0.8 }),
  supplier({ id: "SUP-002", name: "Distributor Jakarta Barat", reliabilityScore: 0.62 }),
  supplier({ id: "SUP-005", name: "Pasar Induk Kramat Jati", status: "excluded" }),
];

describe("filterSuppliers", () => {
  it("mengembalikan semua bila tak ada penyaring", () => {
    expect(filterSuppliers(LIST, {})).toHaveLength(3);
    expect(filterSuppliers(LIST, { query: "   ", status: "all" })).toHaveLength(3);
  });

  it("mencocokkan nama tanpa peduli huruf besar/kecil", () => {
    expect(filterSuppliers(LIST, { query: "koperasi" }).map((s) => s.id)).toEqual(["SUP-001"]);
    expect(filterSuppliers(LIST, { query: "JAKARTA" }).map((s) => s.id)).toEqual(["SUP-002"]);
  });

  it("mencocokkan id pemasok", () => {
    expect(filterSuppliers(LIST, { query: "sup-005" }).map((s) => s.id)).toEqual(["SUP-005"]);
  });

  it("menyaring status", () => {
    expect(filterSuppliers(LIST, { status: "excluded" }).map((s) => s.id)).toEqual(["SUP-005"]);
    expect(filterSuppliers(LIST, { status: "active" }).map((s) => s.id)).toEqual([
      "SUP-001",
      "SUP-002",
    ]);
  });

  it("menyaring skor di bawah ambang (tepat di ambang TIDAK ikut)", () => {
    const ids = filterSuppliers(LIST, { belowThreshold: true }).map((s) => s.id);
    expect(ids).toEqual(["SUP-001", "SUP-002"]);
    expect(filterSuppliers([supplier({ id: "X", reliabilityScore: RELIABILITY_THRESHOLD })], {
      belowThreshold: true,
    })).toHaveLength(0);
  });

  it("menggabungkan penyaring (dan, bukan atau)", () => {
    expect(
      filterSuppliers(LIST, { belowThreshold: true, status: "active" }).map((s) => s.id),
    ).toEqual(["SUP-001", "SUP-002"]);
    expect(
      filterSuppliers(LIST, { query: "jakarta", status: "excluded" }),
    ).toHaveLength(0);
  });

  it("tidak menambah data apa pun — hanya mengurangi", () => {
    expect(filterSuppliers([], { query: "apa saja" })).toEqual([]);
    expect(filterSuppliers(LIST, { query: "tidak ada" })).toEqual([]);
  });
});

describe("isSupplierFilterActive", () => {
  it("false saat semua penyaring kosong atau bernilai default", () => {
    expect(isSupplierFilterActive({})).toBe(false);
    expect(isSupplierFilterActive({ query: "  ", status: "all", belowThreshold: false })).toBe(false);
  });

  it("true saat ada satu penyaring yang bekerja", () => {
    expect(isSupplierFilterActive({ query: "bogor" })).toBe(true);
    expect(isSupplierFilterActive({ status: "excluded" })).toBe(true);
    expect(isSupplierFilterActive({ belowThreshold: true })).toBe(true);
  });
});
