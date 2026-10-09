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
  /** Proyeksi kebutuhan (kg). Opsional — tidak semua lokasi punya data demand. */
  demand?: number;
}

/** Jumlahkan usableStockKg per lokasi untuk bar chart supply + demand. */
export function buildSupplyDemandChartData(
  supplies: SupplyRecord[],
  demands?: { locationId: string; projectedKg: number }[],
): SupplyDemandChartPoint[] {
  const byLocation = new Map<string, number>();
  for (const s of supplies) {
    byLocation.set(s.locationId, (byLocation.get(s.locationId) ?? 0) + s.usableStockKg);
  }

  const demandByLocation = new Map<string, number>();
  if (demands) {
    for (const d of demands) {
      demandByLocation.set(
        d.locationId,
        (demandByLocation.get(d.locationId) ?? 0) + d.projectedKg,
      );
    }
  }

  return Array.from(byLocation.entries()).map(([name, supply]) => ({
    name,
    supply,
    ...(demandByLocation.size > 0 && { demand: demandByLocation.get(name) ?? 0 }),
  }));
}
