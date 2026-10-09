/**
 * Penjaga dataset demo (`lib/mock-data.ts`).
 *
 * Kenapa ada: dataset ini tumbuh (10 -> 22 lokasi, 3 -> 9 komoditas) dan angka pasokan
 * ditulis tangan, jadi satu angka salah (mis. `usableStockKg` > `physicalStockKg`, atau
 * harga tertinggal satu nol) hanya akan terlihat sebagai "demo aneh" saat presentasi.
 * Test ini memeriksa konsistensi ANTAR tabel, bukan cuma bentuk tipe.
 *
 * Aturan yang dijaga:
 *  - pasangan (lokasi, komoditas) unik dan id-nya benar-benar ada;
 *  - `usableStockKg` <= `physicalStockKg`, `batchCount` >= 1;
 *  - status pasokan TURUNAN dari `projectedKg` vs `usableStockKg` (pita seimbang ±15%);
 *  - status lokasi = `deriveLocationStatus()` (`lib/status.ts`) — satu sumber, bukan selera;
 *  - setiap komoditas punya label di `COMMODITY_LABELS` (dulu pernah tertinggal saat
 *    komoditas ditambah);
 *  - jangkar narasi demo (Cianjur surplus 2.300 kg, Jakarta Utara defisit 220 kg, dst) tetap ada.
 */
import { describe, expect, it } from "vitest";

import { COMMODITY_LABELS } from "./labels";
import {
  MOCK_COMMODITIES,
  MOCK_DEMAND,
  MOCK_LOCATIONS,
  MOCK_SUPPLY,
} from "./mock-data";
import { deriveLocationStatus } from "./status";

const BALANCED_BAND = 0.15;

function round10(value: number): number {
  return Math.round(value / 10) * 10;
}

function projectStatus(usableKg: number, projectedKg: number) {
  const delta = usableKg - projectedKg;
  const band = projectedKg * BALANCED_BAND;
  if (delta < -band) return { status: "deficit", deficitKg: round10(-delta), surplusKg: 0 };
  if (delta > band) return { status: "surplus", deficitKg: 0, surplusKg: round10(delta) };
  return { status: "balanced", deficitKg: 0, surplusKg: 0 };
}

const demandByPair = new Map(
  MOCK_DEMAND.map((row) => [`${row.locationId}|${row.commodityId}`, row]),
);
const supplyByLocation = new Map<string, typeof MOCK_SUPPLY>();
for (const row of MOCK_SUPPLY) {
  const list = supplyByLocation.get(row.locationId) ?? [];
  list.push(row);
  supplyByLocation.set(row.locationId, list);
}

describe("dataset demo — bentuk", () => {
  it("memiliki cakupan yang cukup lebar untuk demo nasional", () => {
    // Cakupan dikunci di 10 titik Jabodetabek (keputusan pemilik proyek, 9 Okt): yang tumbuh
    // adalah keragaman komoditas, bukan jumlah lokasi. Batas bawah tetap dijaga supaya dataset
    // tidak menyusut diam-diam saat ada yang mengutak-atik berkas ini.
    expect(MOCK_LOCATIONS.length).toBeGreaterThanOrEqual(10);
    expect(MOCK_COMMODITIES.length).toBeGreaterThanOrEqual(9);
    expect(MOCK_SUPPLY.length).toBeGreaterThanOrEqual(45);
    expect(MOCK_DEMAND.length).toBeGreaterThanOrEqual(25);

    const provinces = new Set(MOCK_LOCATIONS.map((location) => location.region));
    expect(provinces.size).toBeGreaterThanOrEqual(3);
    expect(MOCK_LOCATIONS.some((location) => location.roleHint === "producer_hub")).toBe(true);
    expect(MOCK_LOCATIONS.some((location) => location.roleHint === "demand_hub")).toBe(true);
  });

  it("tidak punya id ganda", () => {
    const locationIds = MOCK_LOCATIONS.map((location) => location.id);
    const commodityIds = MOCK_COMMODITIES.map((commodity) => commodity.id);
    expect(new Set(locationIds).size).toBe(locationIds.length);
    expect(new Set(commodityIds).size).toBe(commodityIds.length);
  });

  it("setiap baris menunjuk lokasi & komoditas yang ada, tanpa pasangan ganda", () => {
    const locations = new Set(MOCK_LOCATIONS.map((location) => location.id));
    const commodities = new Set(MOCK_COMMODITIES.map((commodity) => commodity.id));

    const supplyPairs = MOCK_SUPPLY.map((row) => `${row.locationId}|${row.commodityId}`);
    const demandPairs = MOCK_DEMAND.map((row) => `${row.locationId}|${row.commodityId}`);

    expect(new Set(supplyPairs).size).toBe(supplyPairs.length);
    expect(new Set(demandPairs).size).toBe(demandPairs.length);

    for (const row of [...MOCK_SUPPLY, ...MOCK_DEMAND]) {
      expect(locations.has(row.locationId), `${row.locationId} tidak ada di MOCK_LOCATIONS`).toBe(true);
      expect(commodities.has(row.commodityId), `${row.commodityId} tidak ada di MOCK_COMMODITIES`).toBe(true);
    }
  });

  it("memakai kosakata status dari skema", () => {
    for (const row of MOCK_SUPPLY) {
      expect(["surplus", "balanced", "deficit"]).toContain(row.status);
      expect(["fresh", "approaching_expiry", "expired"]).toContain(row.freshnessStatus);
      expect(["PASS", "FAIL", "NEEDS_VERIFICATION"]).toContain(row.safetyStatus);
    }
  });

  it("memberi label untuk semua komoditas (labels.ts + notifikasi)", () => {
    for (const commodity of MOCK_COMMODITIES) {
      expect(COMMODITY_LABELS[commodity.id], `${commodity.id} tanpa label`).toBeTruthy();
      expect(COMMODITY_LABELS[commodity.name], `${commodity.name} tanpa label nama`).toBeTruthy();
    }
  });
});

describe("dataset demo — angka konsisten", () => {
  it("stok fisik tidak pernah lebih kecil dari stok yang bisa dipakai", () => {
    for (const row of MOCK_SUPPLY) {
      expect(row.usableStockKg, `${row.locationId}/${row.commodityId}`).toBeLessThanOrEqual(
        row.physicalStockKg,
      );
      expect(row.usableStockKg).toBeGreaterThan(0);
      expect(row.batchCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("status pasokan turunan dari proyeksi kebutuhan +-15%", () => {
    for (const row of MOCK_SUPPLY) {
      const demand = demandByPair.get(`${row.locationId}|${row.commodityId}`);
      if (!demand) {
        // Tanpa baris kebutuhan (gudang produsen) status defisit tidak mungkin dijustifikasi.
        expect(row.status, `${row.locationId}/${row.commodityId} defisit tanpa data kebutuhan`).not.toBe(
          "deficit",
        );
        continue;
      }
      const expected = projectStatus(row.usableStockKg, demand.projectedKg);
      expect(row.status, `${row.locationId}/${row.commodityId} status vs proyeksi`).toBe(expected.status);
      expect(demand.deficitKg, `${row.locationId}/${row.commodityId} deficitKg`).toBe(expected.deficitKg);
      expect(demand.surplusKg, `${row.locationId}/${row.commodityId} surplusKg`).toBe(expected.surplusKg);
    }
  });

  it("tidak ada baris kebutuhan tanpa pasokan", () => {
    const supplyPairs = new Set(MOCK_SUPPLY.map((row) => `${row.locationId}|${row.commodityId}`));
    for (const row of MOCK_DEMAND) {
      expect(supplyPairs.has(`${row.locationId}|${row.commodityId}`)).toBe(true);
    }
  });

  it("harga masuk akal dan tidak ada angka tertinggal satu nol", () => {
    for (const commodity of MOCK_COMMODITIES) {
      const prices = MOCK_SUPPLY.filter((row) => row.commodityId === commodity.id).map(
        (row) => row.pricePerKg,
      );
      expect(prices.length, `${commodity.name} tidak dipakai di lokasi mana pun`).toBeGreaterThanOrEqual(3);
      const lowest = Math.min(...prices);
      const highest = Math.max(...prices);
      expect(lowest, `${commodity.name} harga terendah`).toBeGreaterThan(2_000);
      expect(highest / lowest, `${commodity.name} sebaran harga antar wilayah`).toBeLessThan(1.4);
    }
  });
});

describe("dataset demo — status lokasi & narasi", () => {
  it("status lokasi persis hasil deriveLocationStatus atas pasokannya", () => {
    for (const location of MOCK_LOCATIONS) {
      const rows = supplyByLocation.get(location.id) ?? [];
      expect(rows.length, `${location.name} tanpa baris pasokan`).toBeGreaterThan(0);
      expect(location.status, `${location.name}`).toBe(deriveLocationStatus(rows));
    }
  });

  it("menyimpan jangkar narasi demo (Skill.md §11)", () => {
    const cianjur = MOCK_LOCATIONS.find((location) => location.name === "Gudang Cianjur");
    expect(cianjur).toBeDefined();

    const cianjurTelur = MOCK_SUPPLY.find(
      (row) => row.locationId === cianjur!.id && row.commodityId === "com-telur",
    );
    expect(cianjurTelur?.status).toBe("surplus");
    expect(cianjurTelur?.usableStockKg).toBe(2300);

    const jakartaUtaraTelur = MOCK_DEMAND.find(
      (row) => row.locationId === "loc-2" && row.commodityId === "com-telur",
    );
    expect(jakartaUtaraTelur?.deficitKg).toBe(220);

    const jakartaSelatanAyam = MOCK_SUPPLY.find(
      (row) => row.locationId === "loc-4" && row.commodityId === "com-ayam",
    );
    expect(jakartaSelatanAyam?.safetyStatus).toBe("FAIL");
  });

  it("membuat demo tetap punya kasus aman, hampir gagal, dan gagal", () => {
    const statuses = MOCK_SUPPLY.map((row) => row.safetyStatus);
    // Satu batch gagal (Jakarta Selatan/ayam) dan satu titik suhu menyimpang (Jakarta Utara/telur)
    // sudah melekat di baris jangkar narasi; yang dijaga di sini hanya "jangan sampai hilang".
    expect(statuses.filter((status) => status === "FAIL").length).toBeGreaterThanOrEqual(1);
    expect(
      statuses.filter((status) => status === "NEEDS_VERIFICATION").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      MOCK_SUPPLY.filter((row) => row.temperatureExcursion).length,
    ).toBeGreaterThanOrEqual(1);

    const criticals = MOCK_LOCATIONS.filter((location) => location.status === "critical");
    expect(criticals.length).toBeGreaterThanOrEqual(2);
  });
});
