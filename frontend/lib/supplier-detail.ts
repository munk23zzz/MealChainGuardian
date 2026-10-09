/**
 * Logika murni panel Detail Pemasok (kebiasaan repo ini: `.ts` murni + test dulu, komponen tetap
 * presentasional).
 *
 * Di mode nyata isi panel datang apa adanya dari `GET /ui/suppliers/{id}`. Di mode mock tidak ada
 * tabel batch, jadi batch DITURUNKAN dari baris pasokan mock: satu baris pasokan = `batchCount`
 * batch, jumlahnya dibagi rata dan batch terakhir menyerap sisa pembulatan (sama seperti seed
 * backend memecah satu baris jadi beberapa batch — total stok tidak boleh berubah). Waktu panen
 * diturunkan dari status kesegaran baris mock itu, dan seluruh panel ikut ditandai "Data Simulasi"
 * karena situs live memang mode mock.
 */

import type {
  DecisionStatus,
  Supplier,
  SupplierBatch,
  SupplierDetail,
  SupplierExclusionDecision,
  SupplierPrice,
  SupplierPurchaseOrder,
  SupplyRecord,
} from "./api/schema";

/** Masa layak pakai default, cerminan `app/core/shelf_life.py` (72 jam). */
export const SHELF_LIFE_HOURS = 72;

/**
 * Umur panen (jam) per status kesegaran mock.
 *
 * Baris mock hanya menyimpan STATUS (`fresh`/`approaching_expiry`/`expired`), bukan waktu panen.
 * Angkanya dipilih supaya jatuh di pita dokumen yang sama seperti backend (≥0,85 fresh;
 * 0,60–0,85 approaching; <0,60 expired) — jadi panel mock tidak berpura-pura lebih segar.
 */
export const MOCK_HARVEST_AGE_HOURS: Record<SupplyRecord["freshnessStatus"], number> = {
  fresh: 6,
  approaching_expiry: 20,
  expired: 60,
};

/** Skor kesegaran per status, dipakai HANYA di mock supaya kolomnya tidak kosong. */
const MOCK_FRESHNESS_SCORE: Record<SupplyRecord["freshnessStatus"], number> = {
  fresh: 0.95,
  approaching_expiry: 0.7,
  expired: 0.3,
};

const HOUR_MS = 60 * 60 * 1000;

function pecahJumlah(totalKg: number, bagian: number): number[] {
  if (bagian <= 1) return [totalKg];
  const perBagian = Math.round((totalKg / bagian) * 100) / 100;
  const hasil = Array.from({ length: bagian }, () => perBagian);
  // Batch terakhir menyerap selisih pembulatan supaya totalnya persis sama dengan stok fisik.
  hasil[bagian - 1] = Math.round((totalKg - perBagian * (bagian - 1)) * 100) / 100;
  return hasil;
}

/** Batch yang dipasok pemasok ini di mode mock, diturunkan dari baris pasokan lokasinya. */
export function batchesFromSupply(
  supplier: Supplier,
  supply: SupplyRecord[],
  now: Date = new Date(),
): SupplierBatch[] {
  const rows = supply.filter((row) => row.locationId === supplier.locationId);
  const batches: SupplierBatch[] = [];

  rows.forEach((row) => {
    const ageHours = MOCK_HARVEST_AGE_HOURS[row.freshnessStatus];
    const harvestedAt = new Date(now.getTime() - ageHours * HOUR_MS);
    const usableUntil = new Date(harvestedAt.getTime() + SHELF_LIFE_HOURS * HOUR_MS);
    pecahJumlah(row.physicalStockKg, row.batchCount).forEach((quantityKg, index) => {
      batches.push({
        id: `${supplier.id}-${row.commodityId}-${index + 1}`,
        commodityId: row.commodityId,
        locationId: row.locationId,
        quantityKg,
        harvestedAt: harvestedAt.toISOString(),
        usableUntil: usableUntil.toISOString(),
        freshnessScore: MOCK_FRESHNESS_SCORE[row.freshnessStatus],
        freshnessStatus: row.freshnessStatus,
        safetyStatus: row.safetyStatus,
        certificationStatus: "hygiene",
        temperatureReadings: row.temperatureExcursion ? 6 : 12,
        temperatureExcursion: row.temperatureExcursion ?? false,
      });
    });
  });

  return batches;
}

/** Kuotasi harga mock: harga baris pasokan lokasi pemasok itu, ditandai `supplier_quote`. */
export function priceSignalsFromSupply(
  supplier: Supplier,
  supply: SupplyRecord[],
  now: Date = new Date(),
): SupplierPrice[] {
  return supply
    .filter((row) => row.locationId === supplier.locationId)
    .map((row) => ({
      commodityId: row.commodityId,
      pricePerKg: row.pricePerKg,
      source: "supplier_quote",
      recordedAt: new Date(now.getTime() - 8 * HOUR_MS).toISOString(),
    }));
}

/** Detail lengkap untuk mode mock — bentuknya sama dengan respons `/ui/suppliers/{id}`. */
export function buildMockSupplierDetail(
  supplier: Supplier,
  supply: SupplyRecord[],
  decisions: readonly {
    id: string;
    status: DecisionStatus;
    sourceLocationId: string;
    supplierId?: string | null;
    exclusionReason?: string | null;
    reason?: string | null;
    createdAt: string;
    sapPurchaseOrder?: { poNumber: string; plant: string; orderedQuantityKg: number; status: string };
  }[],
  now: Date = new Date(),
): SupplierDetail {
  const batches = batchesFromSupply(supplier, supply, now);

  // PO mock tidak menyimpan supplier; pemasok yang dipilih adalah yang berlokasi SAMA dengan
  // sumber keputusan (cerminan `_execute_defaults` di backend). Jadi PO milik pemasok ini =
  // keputusan yang punya PO dengan `sourceLocationId` = lokasi pemasok.
  const purchaseOrders: SupplierPurchaseOrder[] = decisions
    .filter((d) => d.sapPurchaseOrder && d.sourceLocationId === supplier.locationId)
    .map((d) => ({
      poNumber: d.sapPurchaseOrder!.poNumber,
      materialNumber: "MOCK",
      orderedQuantityKg: d.sapPurchaseOrder!.orderedQuantityKg,
      price: 0,
      status: d.sapPurchaseOrder!.status as SupplierPurchaseOrder["status"],
      decisionId: d.id,
      createdAt: d.createdAt,
    }));

  const exclusionDecisions: SupplierExclusionDecision[] = decisions
    .filter((d) => d.supplierId === supplier.id)
    .map((d) => ({
      decisionId: d.id,
      status: d.status,
      reason: d.exclusionReason ?? d.reason ?? null,
      createdAt: d.createdAt,
    }));

  return {
    supplier,
    batches,
    priceSignals: priceSignalsFromSupply(supplier, supply, now),
    purchaseOrders,
    exclusionDecisions,
  };
}

/**
 * Ringkasan untuk kepala panel.
 *
 * `lowestFreshnessScore` mengabaikan batch yang skornya belum ada (NULL) — kalau dianggap 0,
 * ringkasan akan menuduh pemasok lebih buruk dari data yang sebenarnya tersimpan.
 */
export function summariseSupplierDetail(detail: SupplierDetail): {
  batchCount: number;
  totalQuantityKg: number;
  lowestFreshnessScore: number | null;
  safetyIssueCount: number;
  excursionCount: number;
  openExclusionCount: number;
  purchaseOrderCount: number;
} {
  const skor = detail.batches
    .map((batch) => batch.freshnessScore)
    .filter((value): value is number => value !== null);
  const belumSelesai: DecisionStatus[] = ["proposed", "verifier_flagged", "pending_approval"];

  return {
    batchCount: detail.batches.length,
    totalQuantityKg: Math.round(detail.batches.reduce((sum, b) => sum + b.quantityKg, 0) * 100) / 100,
    lowestFreshnessScore: skor.length === 0 ? null : Math.min(...skor),
    safetyIssueCount: detail.batches.filter(
      (b) => b.safetyStatus === "FAIL" || b.safetyStatus === "NEEDS_VERIFICATION",
    ).length,
    excursionCount: detail.batches.filter((b) => b.temperatureExcursion).length,
    openExclusionCount: detail.exclusionDecisions.filter((d) => belumSelesai.includes(d.status))
      .length,
    purchaseOrderCount: detail.purchaseOrders.length,
  };
}

/** Kuotasi terbaru per komoditas (satu baris per komoditas, yang paling baru menang). */
export function latestPriceByCommodity(signals: SupplierPrice[]): SupplierPrice[] {
  const terbaru = new Map<string, SupplierPrice>();
  for (const signal of signals) {
    const ada = terbaru.get(signal.commodityId);
    if (!ada || signal.recordedAt > ada.recordedAt) terbaru.set(signal.commodityId, signal);
  }
  return Array.from(terbaru.values());
}
