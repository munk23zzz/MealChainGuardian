/**
 * Helpers murni (pure functions) untuk rekomendasi/keputusan.
 */
import type {
  CandidateCostBreakdown,
  DecisionStatus,
  Recommendation,
} from "./api/schema";

/** Filter rekomendasi berdasarkan status. Tanpa status = semua. */
export function filterRecommendations(
  recommendations: Recommendation[],
  status?: DecisionStatus,
): Recommendation[] {
  if (!status) return recommendations;
  return recommendations.filter((r) => r.status === status);
}

/** Urutkan terbaru dulu berdasarkan createdAt (string ISO). */
export function sortRecommendationsNewestFirst(
  recommendations: Recommendation[],
): Recommendation[] {
  return [...recommendations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Kandidat terpilih = total Safe Delivered Cost terendah. */
export function getWinningCandidate(
  recommendation: Recommendation,
): CandidateCostBreakdown | null {
  const candidates = recommendation.safeDeliveredCostBreakdown;
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    c.totalSafeDeliveredCostPerKg < best.totalSafeDeliveredCostPerKg ? c : best,
  );
}

// `targetRegion()` DIHAPUS 10 Okt 2026: satu-satunya pemakainya adalah cek approval
// berbasis wilayah di `components/decisions/approval-actions.tsx`. Sejak cakupan approval
// ditentukan id SPPG (bukan region), helper itu tak lagi punya pemanggil — lebih baik
// dihapus daripada menjadi jalur mati yang menyesatkan.
