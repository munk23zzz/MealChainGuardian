/**
 * LEARN — reliability_score pemasok (Skill.md §10, design.md §3.9c).
 *
 * Ini BUKAN machine learning dan bukan retraining model. Formula deterministik:
 *
 *   reliability_score_baru = clamp(0.5 × reliability_score_lama
 *                                  + 0.5 × success_rate LEARN_WINDOW terakhir, 0, 1)
 *
 * Skill.md §10 menyebut formula ini "acuan (di-tune saat implementasi)" — jadi
 * kalau nanti angka di dokumen berubah, ubah di sini dan test akan menahan.
 * Skor hasil hitungan ini masuk ke Candidate Score keputusan BERIKUTNYA; keputusan
 * yang sudah lewat tidak diubah (Skill.md §10 poin 3).
 */
import type { DeliveryOutcome, SupplierScorePoint } from "./api/schema";

/** Jumlah hasil terakhir yang dipakai ("success_rate_N_terakhir"). */
export const LEARN_WINDOW = 5;

export type { DeliveryOutcome };

/** Rasio sukses 0..1. Tanpa histori → 0 (bukan 1: tidak ada dasar memuji). */
export function successRate(outcomes: DeliveryOutcome[]): number {
  if (outcomes.length === 0) return 0;
  const ok = outcomes.filter((o) => o === "success").length;
  return ok / outcomes.length;
}

/** Satu langkah LEARN. Tanpa histori baru → skor tidak berubah. */
export function applyLearn(
  currentScore: number,
  recentOutcomes: DeliveryOutcome[],
): number {
  if (recentOutcomes.length === 0) return currentScore;
  const window = recentOutcomes.slice(-LEARN_WINDOW);
  const blended = 0.5 * currentScore + 0.5 * successRate(window);
  return Math.min(1, Math.max(0, Math.round(blended * 1000) / 1000));
}

/**
 * Titik skor — bentuknya sama dengan `SupplierScorePoint` di schema, supaya mock,
 * API, dan komponen grafik memakai satu bentuk data (tidak ada dua definisi).
 */
export type ReliabilityPoint = SupplierScorePoint;

export interface ReliabilityEventInput {
  at: string;
  outcome: DeliveryOutcome;
  /** Opsional: dipakai kalau titiknya ingin ditautkan ke keputusan asal. */
  decisionId?: string;
}

/**
 * Replay histori penerimaan jadi deret skor (titik awal + satu titik per kejadian).
 * Urutan mengikuti waktu, bukan urutan input.
 */
export function reliabilitySeries(
  initialScore: number,
  events: ReliabilityEventInput[],
): ReliabilityPoint[] {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const points: ReliabilityPoint[] = [
    { at: null, score: initialScore, outcome: null, isIncident: false },
  ];

  let score = initialScore;
  const seen: DeliveryOutcome[] = [];
  for (const event of ordered) {
    const before = score;
    seen.push(event.outcome);
    // Satu langkah LEARN per penerimaan: 0,5 × skor sebelumnya + 0,5 × success_rate
    // window terakhir. Skor karena itu bergerak MENUJU tingkat sukses terkini.
    score = applyLearn(before, seen);
    points.push({
      at: event.at,
      score,
      outcome: event.outcome,
      isIncident: event.outcome === "failure" || score < before,
      decisionId: event.decisionId,
    });
  }
  return points;
}

/** Ambil ID pemasok dari label kandidat, mis. `"SUP-001 · Koperasi Cianjur"` → `"SUP-001"`. */
export function parseSupplierId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const [id] = raw.split("·");
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Nada status untuk `reliabilityScore`. Ambang disengaja sederhana & bisa dibaca. */
export function reliabilityTone(score: number): "safe" | "warning" | "danger" {
  if (score >= 0.85) return "safe";
  if (score >= 0.7) return "warning";
  return "danger";
}
