/**
 * Matriks komoditas × bahaya biologis — diambil dari temuan resmi (BGN/Kemenkes/
 * lab UGM) atas kasus KLB keracunan MBG. Dipakai untuk memprioritaskan inspeksi:
 * komoditas dengan riwayat bahaya tinggi diperiksa lebih dulu.
 */

export type HazardId = "e_coli" | "staph" | "salmonella" | "bacillus";

export type Hazard = {
  id: HazardId;
  name: string;
  /** Catatan singkat sumber temuan. */
  note: string;
};

export type HazardLevel = "tinggi" | "sedang";

export type CommodityHazard = {
  commodity: string;
  hazard: HazardId;
  level: HazardLevel;
};

export const HAZARDS: Hazard[] = [
  {
    id: "e_coli",
    name: "E. coli",
    note: "Ditemukan pada air, nasi, tahu, dan ayam (BGN, Sep 2025)",
  },
  {
    id: "staph",
    name: "Staphylococcus aureus",
    note: "Ditemukan pada tempe dan bakso (BGN, Sep 2025)",
  },
  {
    id: "salmonella",
    name: "Salmonella",
    note: "Ditemukan pada ayam, telur, dan sayur (BGN, Sep 2025)",
  },
  {
    id: "bacillus",
    name: "Bacillus cereus",
    note: "Ditemukan pada menu mie (BGN, Sep 2025)",
  },
];

export const COMMODITY_HAZARDS: CommodityHazard[] = [
  { commodity: "Air", hazard: "e_coli", level: "tinggi" },
  { commodity: "Nasi", hazard: "e_coli", level: "tinggi" },
  { commodity: "Tahu", hazard: "e_coli", level: "tinggi" },
  { commodity: "Ayam", hazard: "e_coli", level: "tinggi" },
  { commodity: "Ayam", hazard: "salmonella", level: "tinggi" },
  { commodity: "Telur", hazard: "salmonella", level: "tinggi" },
  { commodity: "Sayur", hazard: "salmonella", level: "sedang" },
  { commodity: "Tempe", hazard: "staph", level: "tinggi" },
  { commodity: "Bakso", hazard: "staph", level: "sedang" },
  { commodity: "Mie", hazard: "bacillus", level: "sedang" },
];

export type CommodityRisk = {
  commodity: string;
  level: HazardLevel | "rendah";
  tone: "danger" | "warning" | "safe";
  hazards: Hazard[];
};

function hazardById(id: HazardId): Hazard | undefined {
  return HAZARDS.find((hazard) => hazard.id === id);
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

export function hazardsForCommodity(commodity: string): CommodityHazard[] {
  const key = normalize(commodity);
  return COMMODITY_HAZARDS.filter((row) => normalize(row.commodity) === key);
}

export function commodityRisk(commodity: string): CommodityRisk {
  const rows = hazardsForCommodity(commodity);
  const resolved = rows
    .map((row) => hazardById(row.hazard))
    .filter((hazard): hazard is Hazard => Boolean(hazard));

  if (rows.length === 0) {
    return { commodity, level: "rendah", tone: "safe", hazards: [] };
  }
  const hasHigh = rows.some((row) => row.level === "tinggi");
  return {
    commodity,
    level: hasHigh ? "tinggi" : "sedang",
    tone: hasHigh ? "danger" : "warning",
    hazards: resolved,
  };
}

/** Urutan prioritas inspeksi: risiko tinggi lebih dulu, lalu jumlah bahaya. */
export function prioritizeCommodities(commodities: string[]): CommodityRisk[] {
  const weight = { tinggi: 0, sedang: 1, rendah: 2 } as const;
  return commodities
    .map((commodity) => commodityRisk(commodity))
    .sort(
      (a, b) =>
        weight[a.level] - weight[b.level] || b.hazards.length - a.hazards.length,
    );
}

export function riskMatrix(): { hazard: Hazard; rows: CommodityHazard[] }[] {
  return HAZARDS.map((hazard) => ({
    hazard,
    rows: COMMODITY_HAZARDS.filter((row) => row.hazard === hazard.id),
  }));
}
