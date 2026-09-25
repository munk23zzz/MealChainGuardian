/**
 * Transformasi data untuk chart (pure functions) — menyiapkan data Recharts
 * dari model domain. Frontend hanya menampilkan, tidak menghitung ulang angka.
 */
import type { CandidateCostBreakdown, SupplyRecord } from "./api/schema";

export interface CandidateCostChartPoint {
  name: string;
  totalSafeDeliveredCostPerKg: number;
}

/** Siapkan data bar chart perbandingan kandidat (nama + total biaya). */
export function buildCandidateCostChartData(
  candidates: CandidateCostBreakdown[],
): CandidateCostChartPoint[] {
  return candidates.map((c) => ({
    name: c.supplierId,
    totalSafeDeliveredCostPerKg: c.totalSafeDeliveredCostPerKg,
  }));
}

export interface SupplyDemandChartPoint {
  name: string;
  supply: number;
}

/** Jumlahkan usableStockKg per lokasi untuk bar chart supply. */
export function buildSupplyDemandChartData(
  supplies: SupplyRecord[],
): SupplyDemandChartPoint[] {
  const byLocation = new Map<string, number>();
  for (const s of supplies) {
    byLocation.set(s.locationId, (byLocation.get(s.locationId) ?? 0) + s.usableStockKg);
  }
  return Array.from(byLocation.entries()).map(([name, supply]) => ({
    name,
    supply,
  }));
}
