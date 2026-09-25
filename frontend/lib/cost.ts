/**
 * Komponen Safe Delivered Cost (design.md §3.3, Schema.md §3 `cost_breakdown`).
 *
 * Urutan & nama komponen diambil dari `cost_breakdown` JSONB di Schema.md:
 * purchase, transport, handling, expected_loss, freshness_risk, safety_penalty.
 * Frontend hanya MENAMPILKAN angka dari backend — tidak menghitung ulang
 * (Rules.md §1.1: angka safety-critical dihitung kode deterministik backend).
 */
import type { CandidateCostBreakdown } from "./api/schema";

export type CostComponentKey =
  | "purchase"
  | "transport"
  | "handling"
  | "expected_loss"
  | "freshness_risk"
  | "safety_penalty";

export const COST_COMPONENT_LABELS: Record<CostComponentKey, string> = {
  purchase: "Harga beli",
  transport: "Transport",
  handling: "Handling",
  expected_loss: "Expected loss (susut)",
  freshness_risk: "Freshness risk",
  safety_penalty: "Safety penalty",
};

/** Urutan tampil tabel = urutan design.md §3.3. */
export const COST_COMPONENT_ORDER: CostComponentKey[] = [
  "purchase",
  "transport",
  "handling",
  "expected_loss",
  "freshness_risk",
  "safety_penalty",
];

export interface CostRow {
  key: CostComponentKey;
  label: string;
  amountPerKg: number;
  /** true = komponen tidak dikirim backend (ditampilkan 0 + tanda "data belum ada"). */
  missing: boolean;
}

/** Ubah breakdown kandidat jadi baris tabel siap render. */
export function buildCostRows(candidate: CandidateCostBreakdown): CostRow[] {
  const amounts: Record<CostComponentKey, number | undefined> = {
    purchase: candidate.pricePerKg,
    transport: candidate.transportCostPerKg,
    handling: candidate.handlingCostPerKg,
    expected_loss: candidate.spoilageRiskCostPerKg,
    freshness_risk: candidate.freshnessRiskCostPerKg,
    safety_penalty: candidate.safetyPenaltyPerKg,
  };

  return COST_COMPONENT_ORDER.map((key) => ({
    key,
    label: COST_COMPONENT_LABELS[key],
    amountPerKg: amounts[key] ?? 0,
    missing: amounts[key] === undefined,
  }));
}

export function sumCostRows(rows: CostRow[]): number {
  return rows.reduce((total, row) => total + row.amountPerKg, 0);
}

/**
 * Cek jumlah komponen = total yang dikirim backend (toleransi 1 sen).
 * Kalau tidak sama, backend/agent tidak konsisten → UI menampilkannya sebagai
 * peringatan, bukan diam-diam memakai salah satu angka.
 */
export function costTotalMatches(candidate: CandidateCostBreakdown): boolean {
  const sum = sumCostRows(buildCostRows(candidate));
  return Math.abs(sum - candidate.totalSafeDeliveredCostPerKg) <= 0.01;
}
