/**
 * Helper Evidence Timeline (design.md §3.3): label jenis bukti, nada konsistensi,
 * dan ringkasannya. Murni.
 */
import type { EvidenceItem, EvidenceType } from "./api/schema";
import type { Tone } from "./design-tokens";

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  sap_purchase_order: "SAP — purchase order",
  sap_goods_receipt: "SAP — goods receipt",
  gps: "GPS kendaraan",
  temperature: "Suhu (sensor IoT)",
  human_inspection: "Inspeksi fisik petugas",
  market_price: "Harga pasar (referensi)",
};

/**
 * Konsistensi bukti: true = konsisten (hijau), false = tidak konsisten (merah),
 * null = belum diuji Evidence Fusion (netral — bukan berarti aman).
 */
export function evidenceTone(isConsistent: boolean | null): Tone {
  if (isConsistent === true) return "safe";
  if (isConsistent === false) return "danger";
  return "neutral";
}

export interface EvidenceConsistencySummary {
  consistent: number;
  inconsistent: number;
  unknown: number;
}

export function summarizeEvidenceConsistency(
  items: EvidenceItem[],
): EvidenceConsistencySummary {
  const summary: EvidenceConsistencySummary = {
    consistent: 0,
    inconsistent: 0,
    unknown: 0,
  };
  for (const item of items) {
    if (item.isConsistent === true) summary.consistent += 1;
    else if (item.isConsistent === false) summary.inconsistent += 1;
    else summary.unknown += 1;
  }
  return summary;
}
