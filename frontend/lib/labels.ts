/**
 * Label untuk id domain (lokasi/komoditas/jenis keputusan).
 *
 * Sebelumnya tiap halaman punya map label sendiri — itu bikin teks bisa beda
 * antar screen. Sekarang satu tempat.
 */
import type {
  Commodity,
  DecisionType,
  DemandRecord,
  Location,
  Recommendation,
  SupplyRecord,
} from "./api/schema";

/** Cadangan kalau daftar komoditas dari backend belum tersedia. */
export const COMMODITY_LABELS: Record<string, string> = {
  "com-beras": "Beras",
  "com-telur": "Telur",
  "com-ayam": "Ayam",
  "com-ikan": "Ikan",
  "com-tempe": "Tempe",
  "com-tahu": "Tahu",
  "com-wortel": "Wortel",
  "com-bayam": "Bayam",
  "com-pisang": "Pisang",
  beras: "Beras",
  telur: "Telur",
  ayam: "Ayam",
  ikan: "Ikan",
  tempe: "Tempe",
  tahu: "Tahu",
  wortel: "Wortel",
  bayam: "Bayam",
  pisang: "Pisang",
};

export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  regional_balance: "Ketidakseimbangan regional",
  price_anomaly: "Anomali harga",
  safety_disruption: "Gangguan keamanan pangan",
};

/** Label satu komoditas: pakai daftar dari backend, fallback ke map statis. */
export function commodityLabel(
  commodityId: string,
  commodities: Commodity[] = [],
): string {
  const found = commodities.find((c) => c.id === commodityId || c.name === commodityId);
  if (found) return found.name.charAt(0).toUpperCase() + found.name.slice(1);
  return COMMODITY_LABELS[commodityId] ?? commodityId;
}

/** Label satu lokasi; kalau tidak ditemukan, tampilkan id apa adanya. */
export function locationLabel(locationId: string, locations: Location[]): string {
  return locations.find((l) => l.id === locationId)?.name ?? locationId;
}

/** Nama pendek untuk sumbu chart/popup, mis. "SPPG Jakarta Pusat" -> "Jakarta Pusat". */
export function shortLocationLabel(name: string): string {
  return name.replace(/^(SPPG|Gudang|Gudang SPPG)\s+/i, "");
}

/** Ringkas pasokan satu lokasi untuk kartu/popup peta. */
export interface CommodityLine {
  commodityId: string;
  label: string;
  status: SupplyRecord["status"];
  usableStockKg: number;
}

export function commodityLinesForLocation(
  locationId: string,
  supply: SupplyRecord[],
  commodities: Commodity[] = [],
): CommodityLine[] {
  return supply
    .filter((s) => s.locationId === locationId)
    .map((s) => ({
      commodityId: s.commodityId,
      label: commodityLabel(s.commodityId, commodities),
      status: s.status,
      usableStockKg: s.usableStockKg,
    }));
}

export interface LocationSupplySummary {
  locationId: string;
  lines: CommodityLine[];
  worstStatus: SupplyRecord["status"] | null;
}

/** Satu ringkasan pasokan per lokasi (dipakai grid dashboard & popup peta). */
export function locationSupplySummaries(
  locations: Location[],
  supply: SupplyRecord[],
  commodities: Commodity[] = [],
): LocationSupplySummary[] {
  return locations.map((location) => {
    const lines = commodityLinesForLocation(location.id, supply, commodities);
    return {
      locationId: location.id,
      lines,
      worstStatus: worstSupplyStatus(lines.map((l) => l.status)),
    };
  });
}

const SUPPLY_SEVERITY: Record<SupplyRecord["status"], number> = {
  deficit: 2,
  balanced: 1,
  surplus: 0,
};

export function worstSupplyStatus(
  statuses: SupplyRecord["status"][],
): SupplyRecord["status"] | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, status) =>
    SUPPLY_SEVERITY[status] > SUPPLY_SEVERITY[worst] ? status : worst,
  );
}

/** Cari baris demand untuk lokasi+komoditas tertentu. */
export function findDemand(
  demand: DemandRecord[],
  locationId: string,
  commodityId: string,
): DemandRecord | undefined {
  return demand.find(
    (d) => d.locationId === locationId && d.commodityId === commodityId,
  );
}

/** Feed yang relevan untuk satu lokasi (sebagai sumber atau tujuan). */
export function recommendationsForLocation(
  recommendations: Recommendation[],
  locationId: string,
): Recommendation[] {
  return recommendations.filter(
    (r) =>
      r.sourceLocationId === locationId || r.targetLocationId === locationId,
  );
}
