/**
 * CCP (Critical Control Point) keamanan pangan — ambang dari acuan resmi
 * Kemenkes/BPOM untuk dapur SPPG. Nilai ambang ADA DI SINI (satu tempat),
 * bukan di komponen: frontend tidak boleh mengarang angka safety-critical.
 */

export type CcpCategory = "dingin" | "beku" | "panas" | "proses";
export type CcpStatus = "pass" | "warn" | "fail";

export type CcpRule = {
  id: string;
  label: string;
  category: CcpCategory;
  unit: string;
  /** Batas bawah yang harus dipenuhi (mis. pangan panas > 60 °C). */
  min?: number;
  /** Batas atas yang tidak boleh dilewati (mis. chiller ≤ 4 °C). */
  max?: number;
  /** Toleransi sebelum dinyatakan gagal. */
  warnMargin?: number;
  /**
   * `invert` = nilai di DALAM rentang justru berarti gagal (mis. mengukur
   * keberadaan pangan di zona bahaya 5–60 °C). Dibuat eksplisit supaya aturan
   * semacam ini tidak "kebablasan" dianggap lulus.
   */
  invert?: boolean;
  source: string;
};

/** Zona bahaya pertumbuhan bakteri (acuan Kemenkes). */
export const DANGER_ZONE = { min: 5, max: 60 } as const;

export const CCP_RULES: CcpRule[] = [
  {
    id: "chilled",
    label: "Suhu bahan mentah hewani (chiller)",
    category: "dingin",
    unit: "°C",
    max: 4,
    warnMargin: 1,
    source: "Kemenkes — higiene sanitasi pangan",
  },
  {
    id: "frozen",
    label: "Suhu bahan beku (freezer)",
    category: "beku",
    unit: "°C",
    max: -18,
    warnMargin: 2,
    source: "SNI 01-4108:2007 / HACCP",
  },
  {
    id: "hot-hold",
    label: "Pangan panas siap saji",
    category: "panas",
    unit: "°C",
    min: 60,
    warnMargin: 2,
    source: "Kemenkes — higiene sanitasi pangan",
  },
  {
    id: "danger-zone",
    label: "Pangan keluar dari zona bahaya 5–60 °C",
    category: "proses",
    unit: "°C",
    min: DANGER_ZONE.min,
    max: DANGER_ZONE.max,
    warnMargin: 1,
    invert: true,
    source: "Kemenkes — higiene sanitasi pangan",
  },
  {
    id: "thawing",
    label: "Waktu thawing di chiller",
    category: "proses",
    unit: "jam",
    min: 8,
    max: 9,
    warnMargin: 1,
    source: "Kemenkes — higiene sanitasi pangan",
  },
  {
    id: "cook-to-serve",
    label: "Waktu masak → konsumsi",
    category: "proses",
    unit: "jam",
    max: 4,
    warnMargin: 0.5,
    source: "BGN — batas konsumsi maksimal 4 jam",
  },
];

export type CcpEvaluation = {
  ruleId: string;
  status: CcpStatus;
  tone: "safe" | "warning" | "danger";
  message: string;
};

const TONE: Record<CcpStatus, CcpEvaluation["tone"]> = {
  pass: "safe",
  warn: "warning",
  fail: "danger",
};

function asNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
}

/**
 * Evaluasi satu titik kendali. Nilai kosong = belum diukur → "warn"
 * (belum terverifikasi), bukan "pass": jangan pernah menyatakan aman tanpa data.
 */
export function evaluateCcp(
  rule: CcpRule,
  value: number | null | undefined,
): CcpEvaluation {
  const measured = asNumber(value);
  const margin = rule.warnMargin ?? 0;

  if (measured === null) {
    return {
      ruleId: rule.id,
      status: "warn",
      tone: TONE.warn,
      message: `Belum ada pengukuran untuk ${rule.label.toLowerCase()}`,
    };
  }

  const hasMin = rule.min !== undefined;
  const hasMax = rule.max !== undefined;
  let status: CcpStatus;

  if (rule.invert && hasMin && hasMax) {
    // Nilai terukur adalah SUHU PANGAN: berada di dalam rentang = gagal.
    const inside = measured >= rule.min! && measured <= rule.max!;
    const nearEdge =
      measured >= rule.min! - margin && measured <= rule.max! + margin;
    status = inside ? "fail" : nearEdge ? "warn" : "pass";
    const message =
      status === "pass"
        ? `Di luar zona bahaya ${rule.min}–${rule.max}${rule.unit} (aman)`
        : status === "warn"
          ? `Mendekati zona bahaya ${rule.min}–${rule.max}${rule.unit}`
          : `Berada di zona bahaya ${rule.min}–${rule.max}${rule.unit} — perlu tindakan`;
    return { ruleId: rule.id, status, tone: TONE[status], message };
  }

  if (hasMin && hasMax) {
    const inside = measured >= rule.min! && measured <= rule.max!;
    const near =
      measured >= rule.min! - margin && measured <= rule.max! + margin;
    status = inside ? "pass" : near ? "warn" : "fail";
  } else if (hasMax) {
    status =
      measured <= rule.max!
        ? "pass"
        : measured <= rule.max! + margin
          ? "warn"
          : "fail";
  } else if (hasMin) {
    status =
      measured >= rule.min!
        ? "pass"
        : measured >= rule.min! - margin
          ? "warn"
          : "fail";
  } else {
    status = "warn";
  }

  const limit = hasMin && hasMax
    ? `di antara ${rule.min}–${rule.max}${rule.unit}`
    : hasMax
      ? `maksimal ${rule.max}${rule.unit}`
      : `minimal ${rule.min}${rule.unit}`;

  const message =
    status === "pass"
      ? `Sesuai standar (${limit})`
      : status === "warn"
        ? `Mendekati batas (${limit}) — perlu verifikasi`
        : `Di luar standar (${limit}) — perlu tindakan`;

  return { ruleId: rule.id, status, tone: TONE[status], message };
}

export type CcpSummary = {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  /** Persentase titik yang benar-benar sesuai standar. */
  compliancePercent: number;
  tone: "safe" | "warning" | "danger";
};

export function summarizeCcp(evaluations: CcpEvaluation[]): CcpSummary {
  const pass = evaluations.filter((e) => e.status === "pass").length;
  const warn = evaluations.filter((e) => e.status === "warn").length;
  const fail = evaluations.filter((e) => e.status === "fail").length;
  const total = evaluations.length;
  const compliancePercent = total === 0 ? 0 : Math.round((pass / total) * 100);
  const tone: CcpSummary["tone"] =
    fail > 0 ? "danger" : warn > 0 ? "warning" : "safe";
  return { total, pass, warn, fail, compliancePercent, tone };
}

export function ruleById(id: string): CcpRule | undefined {
  return CCP_RULES.find((rule) => rule.id === id);
}
