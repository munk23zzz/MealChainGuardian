/**
 * Urgensi feed rekomendasi & ringkasan hard constraint (design.md §3.2 & §3.3).
 * Murni.
 */
import type { ConstraintCheck, ConstraintName, Recommendation } from "./api/schema";

/** 0 = paling mendesak. */
export type UrgencyTier = 0 | 1 | 2;

export const URGENCY_LABELS: Record<UrgencyTier, string> = {
  0: "Isu keamanan",
  1: "Ketidakseimbangan regional",
  2: "Anomali harga",
};

/**
 * Urgensi: safety issue > regional imbalance > price anomaly (design.md §3.2).
 *
 * Safety menang walau decisionType-nya bukan safety_disruption — kalau status
 * keamanannya bukan PASS, itu yang harus dilihat user lebih dulu.
 */
export function urgencyTier(recommendation: Recommendation): UrgencyTier {
  if (
    recommendation.safetyCheck !== "PASS" ||
    recommendation.decisionType === "safety_disruption"
  ) {
    return 0;
  }
  if (recommendation.decisionType === "price_anomaly") return 2;
  return 1;
}

export function urgencyLabel(recommendation: Recommendation): string {
  return URGENCY_LABELS[urgencyTier(recommendation)];
}

/** Urutkan per tier urgensi, lalu terbaru dulu di dalam tier yang sama. */
export function sortRecommendationsByUrgency(
  recommendations: Recommendation[],
): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    const tierDiff = urgencyTier(a) - urgencyTier(b);
    if (tierDiff !== 0) return tierDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export const CONSTRAINT_LABELS: Record<ConstraintName, string> = {
  safety_eligibility: "Kelayakan keamanan (safety eligibility)",
  freshness_threshold: "Ambang kesegaran (freshness threshold)",
  capacity: "Kapasitas angkut (capacity)",
  delivery_window: "Jendela pengiriman (delivery window)",
};

export interface ConstraintSummary {
  passed: number;
  failed: number;
  total: number;
  /** true hanya kalau ada data DAN tidak ada yang gagal. */
  allPassed: boolean;
}

/**
 * Ringkas hasil hard constraint check.
 * Constraint yang belum dikirim backend TIDAK dianggap lolos (Rules.md §1.3:
 * status keamanan tidak boleh diklaim lebih baik dari kenyataan).
 */
export function summarizeConstraints(
  constraints: ConstraintCheck[] | undefined,
): ConstraintSummary {
  const list = constraints ?? [];
  const failed = list.filter((c) => !c.passed).length;
  return {
    passed: list.length - failed,
    failed,
    total: list.length,
    allPassed: list.length > 0 && failed === 0,
  };
}
