/**
 * Ringkasan untuk Approval Modal (design.md §3.5).
 *
 * Dipisah dari komponen supaya isi ringkasan bisa diuji tanpa DOM — modal ini
 * "friksi yang disengaja": isinya tidak boleh kosong/terlewat.
 */
import { summarizeEvidenceConsistency } from "./evidence";
import { getWinningCandidate } from "./decisions";
import { formatKg, formatRupiah } from "./format";
import { summarizeConstraints } from "./urgency";
import type { Recommendation } from "./api/schema";

export interface ApprovalSummary {
  /** Apa yang akan dieksekusi. */
  what: string;
  /** Ke SAP mana (mock) dan dengan biaya berapa. */
  sapTarget: string;
  /** Ringkasan evidence utama. */
  evidenceLine: string;
  /** Ringkasan hard constraint; null kalau backend belum mengirim data ini. */
  constraintLine: string | null;
  /** Hasil audit Verifier Agent. */
  verifierLine: string;
  /** true = Verifier memberi catatan/flag, bukan sekadar "tidak ada temuan". */
  verifierIsFlag: boolean;
}

export function buildApprovalSummary(
  recommendation: Recommendation,
  labels: {
    locationLabel?: (id: string) => string;
    commodityLabel?: (id: string) => string;
  } = {},
): ApprovalSummary {
  const locationLabel = labels.locationLabel ?? ((id: string) => id);
  const commodityLabel = labels.commodityLabel ?? ((id: string) => id);

  const winner = getWinningCandidate(recommendation);
  const sapParts = [
    `plant ${locationLabel(recommendation.targetLocationId)}`,
    winner ? `kandidat ${winner.supplierId}` : null,
    winner ? `total ${formatRupiah(winner.totalSafeDeliveredCostPerKg)}/kg` : null,
  ].filter(Boolean);

  const evidenceItems = recommendation.evidenceItems ?? [];
  const consistency = summarizeEvidenceConsistency(evidenceItems);
  const sourceFlags = [
    recommendation.evidence.sap ? "SAP" : null,
    recommendation.evidence.iot ? "IoT" : null,
    recommendation.evidence.physical ? "inspeksi fisik" : null,
  ].filter(Boolean);
  const inconsistencyCount = recommendation.evidence.inconsistencies.length;

  const evidenceLine =
    evidenceItems.length > 0
      ? `Kelengkapan bukti ${recommendation.evidence.completenessPercent}% · ` +
        `${consistency.consistent} bukti konsisten` +
        (consistency.inconsistent > 0
          ? `, ${consistency.inconsistent} tidak konsisten`
          : "") +
        (consistency.unknown > 0 ? `, ${consistency.unknown} belum diuji` : "")
      : `Kelengkapan bukti ${recommendation.evidence.completenessPercent}%` +
        (sourceFlags.length > 0 ? ` · sumber: ${sourceFlags.join(", ")}` : "") +
        (inconsistencyCount > 0
          ? ` · ${inconsistencyCount} inkonsistensi dilaporkan`
          : "");

  const constraints = summarizeConstraints(recommendation.constraints);
  const constraintLine =
    constraints.total > 0
      ? `Hard constraint: ${constraints.passed}/${constraints.total} lolos` +
        (constraints.failed > 0 ? ` — ${constraints.failed} gagal` : "")
      : null;

  const verifierLine = recommendation.verifierNote
    ? recommendation.verifierNote +
      (recommendation.verifiedBy ? ` (${recommendation.verifiedBy})` : "")
    : "Tidak ada flag dari Verifier Agent.";

  return {
    what:
      `Kirim ${formatKg(recommendation.quantityKg)} ` +
      `${commodityLabel(recommendation.commodityId)} dari ` +
      `${locationLabel(recommendation.sourceLocationId)} ke ` +
      `${locationLabel(recommendation.targetLocationId)}`,
    sapTarget: `Purchase order dibuat di SAP (mock SAP, data simulasi) untuk ${sapParts.join(" · ")}.`,
    evidenceLine,
    constraintLine,
    verifierLine,
    verifierIsFlag: Boolean(recommendation.verifierNote),
  };
}
