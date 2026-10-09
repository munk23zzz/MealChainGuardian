/**
 * Helpers murni (pure functions) untuk rekomendasi/keputusan.
 */
import type {
  CandidateCostBreakdown,
  DecisionStatus,
  Location,
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

/**
 * Region lokasi tujuan sebuah keputusan.
 *
 * Dipakai untuk cek scope approval: sppg_head/sppg_nutritionist hanya boleh
 * approve di region-nya (lib/auth.ts `canApproveForLocation`). Diekstrak ke sini
 * supaya halaman punya satu tempat pengambilan region yang bisa diuji — bug
 * "tombol Approve tidak pernah muncul" berasal dari region yang tidak dioper.
 *
 * Lokasi yang tidak ditemukan mengembalikan `undefined` (bukan region tebakan):
 * tanpa region, izin approve harus gagal-tertutup, bukan terbuka.
 */
export function targetRegion(
  recommendation: Recommendation,
  locations: Location[],
): string | undefined {
  return locations.find((l) => l.id === recommendation.targetLocationId)?.region;
}
