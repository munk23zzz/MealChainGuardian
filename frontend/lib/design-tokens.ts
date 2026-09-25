/**
 * Design token MealChain Guardian — satu-satunya sumber kebenaran warna & label
 * status di frontend.
 *
 * Sumber: `docs/design.md` §4 "Design system". Nilai hex di bawah JANGAN diubah
 * tanpa mengubah dokumen tersebut (design.md §4: "konsisten dengan proposal —
 * jangan ganti tanpa alasan kuat"). Kalau butuh warna di luar palet ini,
 * tambahkan dulu ke design.md — bukan langsung ke komponen.
 *
 * File ini murni (tanpa React/DOM) supaya bisa diuji dengan vitest.
 */
import type {
  DecisionStatus,
  LocationStatus,
  SafetyStatus,
  SupplyRecord,
} from "./api/schema";

/** Palet dari Afghan Product Dashboard. */
export const PALETTE = {
  navy900: "#1E293B", // teks utama
  navy700: "#0969DA", // aksen utama (sidebar, tombol primer)
  navy100: "#F5F6FA", // background card netral
  grey500: "#64748B", // teks sekunder, caption
  statusSafe: "#10B981", // PASS / normal (hijau)
  statusWarning: "#F97316", // tight / needs verification (orange)
  statusDanger: "#EF4444", // FAIL / shortage kritis (merah)
} as const;

/** Nada visual yang dipakai StatusBadge dan elemen status lain. */
export type Tone = "safe" | "warning" | "danger" | "info" | "neutral";

/** Enum status keputusan sesuai `docs/Schema.md` §3 (`decisions.status`). */
export type DecisionStatusKey = DecisionStatus;

const TONE_COLORS: Record<Tone, string> = {
  safe: PALETTE.statusSafe,
  warning: PALETTE.statusWarning,
  danger: PALETTE.statusDanger,
  info: PALETTE.navy700,
  neutral: PALETTE.grey500,
};

/**
 * Kelas Tailwind per nada. Memakai nama token (bukan hex) supaya pewarnaan tetap
 * lewat tailwind.config.ts.
 *
 * Catatan aksesibilitas: teks badge warning memakai navy-900 karena #F9A825 di
 * atas latar terang tidak terbaca (design.md §4 prinsip 2: status tidak boleh
 * ambigu sekilas). Tidak ada warna baru — masih palet design.md.
 */
const TONE_CLASSES: Record<Tone, string> = {
  safe: "border-brand-green/40 bg-brand-green/10 text-brand-green",
  warning: "border-brand-orange/50 bg-brand-orange/20 text-navy-900",
  danger: "border-brand-red/40 bg-brand-red/10 text-brand-red",
  info: "border-brand-sidebar/30 bg-brand-sidebar/10 text-brand-sidebar",
  neutral: "border-grey-500/30 bg-grey-500/10 text-grey-500",
};

export function toneColor(tone: Tone): string {
  return TONE_COLORS[tone];
}

export function toneClasses(tone: Tone): string {
  return TONE_CLASSES[tone];
}

// ---------------------------------------------------------------------------
// Status lokasi (design.md §3.1): hijau normal, kuning tight, merah kritis
// ---------------------------------------------------------------------------

const LOCATION_COLORS: Record<LocationStatus, string> = {
  ok: PALETTE.statusSafe,
  warning: PALETTE.statusWarning,
  critical: PALETTE.statusDanger,
};

const LOCATION_LABELS: Record<LocationStatus, string> = {
  ok: "Normal",
  warning: "Tight",
  critical: "Kritis",
};

const LOCATION_TONES: Record<LocationStatus, Tone> = {
  ok: "safe",
  warning: "warning",
  critical: "danger",
};

export function locationStatusColor(status: LocationStatus): string {
  return LOCATION_COLORS[status];
}

export function locationStatusLabel(status: LocationStatus): string {
  return LOCATION_LABELS[status];
}

export function locationStatusTone(status: LocationStatus): Tone {
  return LOCATION_TONES[status];
}

// ---------------------------------------------------------------------------
// Status keamanan (design.md §4 prinsip 2) — PASS/FAIL/NEEDS_VERIFICATION
// ---------------------------------------------------------------------------

const SAFETY_TONES: Record<SafetyStatus, Tone> = {
  PASS: "safe",
  NEEDS_VERIFICATION: "warning",
  FAIL: "danger",
};

const SAFETY_LABELS: Record<SafetyStatus, string> = {
  PASS: "PASS — aman",
  NEEDS_VERIFICATION: "NEEDS_VERIFICATION — perlu verifikasi",
  FAIL: "FAIL — tidak layak",
};

export function safetyStatusColor(status: SafetyStatus): string {
  return toneColor(SAFETY_TONES[status]);
}

export function safetyStatusLabel(status: SafetyStatus): string {
  return SAFETY_LABELS[status];
}

export function safetyStatusTone(status: SafetyStatus): Tone {
  return SAFETY_TONES[status];
}

// ---------------------------------------------------------------------------
// Status keputusan (design.md §3.2 & Schema.md §3)
// ---------------------------------------------------------------------------

const DECISION_TONES: Record<DecisionStatusKey, Tone> = {
  proposed: "neutral",
  verifier_flagged: "danger",
  pending_approval: "warning",
  approved: "safe",
  rejected: "danger",
  executed: "info",
};

const DECISION_LABELS: Record<DecisionStatusKey, string> = {
  proposed: "Diusulkan",
  verifier_flagged: "Ditandai Verifier",
  pending_approval: "Menunggu approval",
  approved: "Disetujui",
  rejected: "Ditolak",
  executed: "Dieksekusi",
};

export function decisionStatusColor(status: DecisionStatusKey): string {
  return toneColor(DECISION_TONES[status]);
}

export function decisionStatusLabel(status: DecisionStatusKey): string {
  return DECISION_LABELS[status];
}

export function decisionStatusTone(status: DecisionStatusKey): Tone {
  return DECISION_TONES[status];
}

const DECISION_STATUS_VALUES: DecisionStatusKey[] = [
  "proposed",
  "verifier_flagged",
  "pending_approval",
  "approved",
  "rejected",
  "executed",
];

/**
 * Normalkan status dari backend ke enum Schema.md.
 *
 * Mapping legacy: frontend versi lama memakai `pending_review`, Schema.md
 * memakai `pending_approval`. Nilai tak dikenal TIDAK ditebak — jatuh ke
 * `proposed` (default di Schema.md) supaya UI tidak pernah mengklaim status yang
 * lebih "aman" dari kenyataan.
 */
export function normalizeDecisionStatus(raw: string): DecisionStatusKey {
  if (raw === "pending_review") return "pending_approval";
  const found = DECISION_STATUS_VALUES.find((s) => s === raw);
  return found ?? "proposed";
}

// ---------------------------------------------------------------------------
// Status pasokan (design.md §3.1 & StatusBadge: surplus/shortage/tight)
// ---------------------------------------------------------------------------

export function supplyStatusTone(status: SupplyRecord["status"]): Tone {
  switch (status) {
    case "surplus":
      return "info";
    case "deficit":
      return "warning";
    default:
      return "safe";
  }
}

const SUPPLY_LABELS: Record<SupplyRecord["status"], string> = {
  surplus: "Surplus",
  balanced: "Seimbang",
  deficit: "Defisit",
};

export function supplyStatusLabel(status: SupplyRecord["status"]): string {
  return SUPPLY_LABELS[status];
}
