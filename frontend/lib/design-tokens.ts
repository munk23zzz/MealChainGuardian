/**
 * Design token MealChain Guardian — satu-satunya sumber kebenaran warna & label
 * status di frontend.
 *
 * Sumber: `docs/design.md` §4 "Design system". Nilai hex di bawah JANGAN diubah
 * tanpa mengubah dokumen tersebut (design.md §4: "konsisten dengan proposal —
 * jangan ganti tanpa alasan kuat"). Kalau butuh warna di luar palet ini,
 * tambahkan dulu ke design.md — bukan langsung ke komponen.
 *
 * Model warna (hybrid, diputuskan bersama Roy — tercatat di design.md §4):
 * - `navy900/navy700/navy100/grey500` : teks, heading, border, permukaan netral.
 * - `brandBlue/brandBlueActive`       : header, sidebar, tombol, link ("tema biru").
 * - `statusSafe/Warning/Danger`       : status keamanan & lokasi (bukan dekorasi).
 *
 * File ini murni (tanpa React/DOM) supaya bisa diuji dengan vitest.
 */
import type {
  DecisionStatus,
  LocationStatus,
  SafetyStatus,
  SupplyRecord,
} from "./api/schema";

/** Palet design.md §4 + aksen biru brand (hybrid). */
export const PALETTE = {
  navy900: "#1F3B4D", // teks utama & heading
  navy700: "#2E5266", // aksen sekunder (tautan non-aksi, badge informasi)
  navy100: "#DCE6E9", // border & permukaan netral
  grey500: "#555555", // teks sekunder, caption
  statusSafe: "#2E7D32", // PASS / normal (hijau)
  statusWarning: "#F9A825", // tight / needs verification (kuning)
  statusDanger: "#C62828", // FAIL / shortage kritis (merah)
  brandBlue: "#0969DA", // header, sidebar, tombol primer, link
  brandBlueActive: "#0550AE", // keadaan aktif/hover elemen brand
  surface: "#F5F6FA", // latar halaman
  /**
   * Garis grid & sumbu grafik (Recharts butuh nilai warna literal, bukan kelas
   * Tailwind). Netral terang: cukup terlihat sebagai pemandu, tidak bersaing
   * dengan data. Nilai ini sudah dipakai grafik sejak awal dan sekarang bernama
   * supaya tidak ada hex yang ditulis di komponen.
   */
  plotGrid: "#B0BEC5",
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
  safe: "border-status-safe/40 bg-status-safe/10 text-status-safe",
  warning: "border-status-warning/50 bg-status-warning/20 text-navy-900",
  danger: "border-status-danger/40 bg-status-danger/10 text-status-danger",
  info: "border-navy-700/30 bg-navy-700/10 text-navy-700",
  neutral: "border-grey-500/30 bg-grey-500/10 text-grey-500",
};

export function toneColor(tone: Tone): string {
  return TONE_COLORS[tone];
}

export function toneClasses(tone: Tone): string {
  return TONE_CLASSES[tone];
}

/**
 * Kelas Tailwind untuk elemen interaktif (tema biru). Dipakai agar tidak ada
 * komponen yang menulis warna aksi sendiri-sendiri — sumbernya satu, di sini.
 */
export const INTERACTIVE_CLASSES = {
  /** Tautan teks (mis. "Lihat semua", "← Kembali ke feed"). */
  link: "text-brand hover:underline",
  /** Tombol/aksi utama. */
  primary: "bg-brand text-white hover:bg-brand-active",
  /** Permukaan header & sidebar. */
  chrome: "bg-brand text-white",
  /** Item navigasi yang sedang aktif. */
  chromeActive: "bg-brand-active text-white",
} as const;

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
  // Perlu 2 approval (Schema.md §3): satu Kepala SPPG + satu Ahli Gizi penerima.
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
