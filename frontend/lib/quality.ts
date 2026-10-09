/**
 * Kualitas agen (padanan ringan AgentCore Evaluations) — murni & bisa diuji.
 * Tujuannya: kualitas agen diukur dan ditampilkan, bukan diklaim.
 */

export type AgentRun = {
  id: string;
  steps: number;
  /** Berapa langkah yang jatuh ke model cadangan (fallback). */
  fallbacks: number;
  /** Hasil pendapat kedua verifier: setuju / tidak setuju / tidak tersedia. */
  verifierAgreement: "agree" | "disagree" | "unavailable";
  decisionsApproved: number;
  decisionsOverridden: number;
  ccpCompliant: boolean;
};

export type AgentScorecard = {
  runs: number;
  totalSteps: number;
  fallbackRate: number;
  agreementRate: number;
  overrideRate: number;
  ccpComplianceRate: number;
  tone: QualityTone;
};

/**
 * Ambang penilaian kualitas. Ditaruh di lib (bukan di komponen) supaya titik
 * status di kartu dan kesimpulan keseluruhan tidak pernah berbeda diam-diam.
 */
export const QUALITY_THRESHOLDS = {
  /** Rate fallback di atas ini = perlu perhatian. */
  fallbackWarning: 0.15,
  /** Override manusia di atas ini = perlu perhatian. */
  overrideWarning: 0.1,
  /** Override manusia di atas ini = bahaya (agen sering dikoreksi). */
  overrideDanger: 0.25,
  /** Kepatuhan CCP di bawah ini = bahaya. */
  ccpMinCompliant: 0.9,
  /** Kesesuaian verifier di bawah ini = perlu perhatian. */
  agreementWarning: 1,
} as const;

export type QualityTone = "safe" | "warning" | "danger";

/** Rate fallback tinggi = agen sering jatuh ke model cadangan. */
export function fallbackTone(rate: number): QualityTone {
  return rate > QUALITY_THRESHOLDS.fallbackWarning ? "warning" : "safe";
}

/** Verifier tidak selalu setuju; kurang dari 100% sudah layak ditandai. */
export function agreementTone(rate: number): QualityTone {
  return rate >= QUALITY_THRESHOLDS.agreementWarning ? "safe" : "warning";
}

/** Manusia mengubah usulan agen = sinyal mutu; makin sering, makin berat. */
export function overrideTone(rate: number): QualityTone {
  if (rate > QUALITY_THRESHOLDS.overrideDanger) return "danger";
  return rate > QUALITY_THRESHOLDS.overrideWarning ? "warning" : "safe";
}

/** Kepatuhan CCP adalah soal keamanan pangan: di bawah ambang = bahaya. */
export function ccpTone(rate: number): QualityTone {
  return rate < QUALITY_THRESHOLDS.ccpMinCompliant ? "danger" : "safe";
}

/** Tone tiap metrik yang ditampilkan, dihitung sekali di lib. */
export function scorecardTones(scorecard: AgentScorecard): {
  fallback: QualityTone;
  agreement: QualityTone;
  override: QualityTone;
  ccp: QualityTone;
} {
  return {
    fallback: fallbackTone(scorecard.fallbackRate),
    agreement: agreementTone(scorecard.agreementRate),
    override: overrideTone(scorecard.overrideRate),
    ccp: ccpTone(scorecard.ccpComplianceRate),
  };
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function agentScorecard(runs: AgentRun[]): AgentScorecard {
  const totalSteps = runs.reduce((sum, run) => sum + run.steps, 0);
  const fallbacks = runs.reduce((sum, run) => sum + run.fallbacks, 0);

  const comparable = runs.filter((run) => run.verifierAgreement !== "unavailable");
  const agreed = comparable.filter((run) => run.verifierAgreement === "agree").length;

  const approved = runs.reduce((sum, run) => sum + run.decisionsApproved, 0);
  const overridden = runs.reduce((sum, run) => sum + run.decisionsOverridden, 0);

  const compliant = runs.filter((run) => run.ccpCompliant).length;

  const fallbackRate = rate(fallbacks, totalSteps);
  const overrideRate = rate(overridden, approved + overridden);
  const ccpComplianceRate = rate(compliant, runs.length);

  // Tone menandai hal yang perlu perhatian, bukan "bagus/tidak". Aturannya
  // dipakai bersama oleh titik status tiap kartu (scorecardTones) supaya kartu
  // dan kesimpulan tidak bisa berbeda.
  const overrideLevel = overrideTone(overrideRate);
  const tone: QualityTone =
    ccpTone(ccpComplianceRate) === "danger" || overrideLevel === "danger"
      ? "danger"
      : fallbackTone(fallbackRate) === "warning" || overrideLevel === "warning"
        ? "warning"
        : "safe";

  return {
    runs: runs.length,
    totalSteps,
    fallbackRate,
    agreementRate: rate(agreed, comparable.length),
    overrideRate,
    ccpComplianceRate,
    tone,
  };
}

export function formatRate(value: number, digits = 0): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return `${(clamped * 100).toFixed(digits)}%`;
}
