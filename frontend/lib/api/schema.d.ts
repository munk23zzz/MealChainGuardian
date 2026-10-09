/**
 * MealChain Guardian — API schema types.
 *
 * Ditulis manual dari kontrak interface di docs/frontend.md (backend/openapi.json
 * belum tersedia saat langkah ini dijalankan). Saat backend mulai menghasilkan
 * openapi.json, regenerate file ini dari spec tersebut dan cocokkan ulang.
 *
 * Semua tipe di sini mencerminkan bentuk data yang diterima frontend dari
 * FastAPI backend — frontend tidak menghitung ulang angka, hanya menampilkan.
 */

/**
 * Peran pengguna.
 *  - sppg_head        : Kepala SPPG, bisa approve, scope terbatas per region
 *  - sppg_nutritionist: Ahli gizi SPPG, bisa approve, scope terbatas per region
 *  - bgn_monitor      : Monitor BGN, read-only, tidak ada batasan lokasi
 *  - sppg_staff       : (legacy) Staff SPPG, bisa approve untuk locationId-nya
 *  - dinas_admin      : (legacy) Admin Dinas, bisa approve semua lokasi
 */
export type Role =
  | "sppg_head"
  | "sppg_nutritionist"
  | "bgn_monitor"
  | "sppg_staff"
  | "dinas_admin";

/** Nama komoditas demo — mengikuti dokumen ide (`docs/Schema.md` §1, `docs/PRD.md`): 3 komoditas. */
export type CommodityName = "telur" | "ayam" | "wortel";

/**
 * Status satu keputusan/rekomendasi.
 * Enum HARUS sama dengan `decisions.status` di `docs/Schema.md` §3 —
 * frontend tidak boleh punya status sendiri yang tidak dikenal backend.
 */
export type DecisionStatus =
  | "proposed"
  | "verifier_flagged"
  | "verifier_unavailable"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "expired";

/**
 * Jenis keputusan (Schema.md §3 `decisions.decision_type`). Dipakai untuk
 * mengurutkan feed berdasarkan urgensi (design.md §3.2) dan menamai keputusan.
 */
export type DecisionType =
  | "regional_balance"
  | "price_anomaly"
  | "safety_disruption";

/** Hard constraint yang diperiksa sebelum kandidat boleh muncul (Skill.md §2). */
export type ConstraintName =
  | "safety_eligibility"
  | "freshness_threshold"
  | "capacity"
  | "delivery_window";

export interface ConstraintCheck {
  name: ConstraintName;
  passed: boolean;
  /** Alasan singkat, mis. "sisa umur simpan 2 hari < ambang 3 hari". */
  detail?: string;
}

/** Jenis bukti (Schema.md §3 `decision_evidence.evidence_type`). */
export type EvidenceType =
  | "sap_purchase_order"
  | "sap_goods_receipt"
  | "gps"
  | "temperature"
  | "human_inspection"
  | "market_price";

/** Satu bukti dalam Evidence Timeline (design.md §3.3). */
export interface EvidenceItem {
  id?: string;
  type: EvidenceType;
  /** Sumber yang bisa ditelusuri, mis. "SAP PO 4500001234". */
  source: string;
  summary?: string;
  recordedAt: string;
  /** null = belum ada hasil consistency check (Evidence Fusion belum jalan). */
  isConsistent: boolean | null;
}


/** Hasil evaluasi keamanan — TIDAK BOLEH di-override frontend maupun agent. */
export type SafetyStatus = "PASS" | "FAIL" | "NEEDS_VERIFICATION";

/** Tahap dalam alur reasoning agent. */
export type AgentStepName =
  | "DETECT"
  | "VERIFY"
  | "TRACE"
  | "PREDICT"
  | "OPTIMIZE"
  | "DECIDE"
  | "ACT"
  | "LEARN";

/** Status agregat sebuah lokasi untuk pewarnaan marker peta. */
export type LocationStatus = "ok" | "warning" | "critical";

/** Satuan kuantitas. */
export type Unit = "kg";

export interface Location {
  id: string;
  name: string;
  /** Wilayah (Schema.md §1 `locations.region`), mis. "DKI Jakarta". */
  region: string;
  latitude: number;
  longitude: number;
  /** Petunjuk peran lokasi (Schema.md §1 `locations.role_hint`). */
  roleHint?: "demand_hub" | "producer_hub" | "mixed";
  status: LocationStatus;
}

export interface Commodity {
  id: string;
  name: CommodityName;
  unit: Unit;
}

/** Data pasokan per lokasi/komoditas. */
export interface SupplyRecord {
  locationId: string;
  commodityId: string;
  physicalStockKg: number;
  usableStockKg: number;
  batchCount: number;
  status: "surplus" | "balanced" | "deficit";
  pricePerKg: number;
  freshnessStatus: "fresh" | "approaching_expiry" | "expired";
  safetyStatus: SafetyStatus;
  temperatureExcursion?: boolean;
}

/** Proyeksi kebutuhan per lokasi/komoditas. */
export interface DemandRecord {
  locationId: string;
  commodityId: string;
  projectedKg: number;
  deficitKg: number;
  surplusKg: number;
}

/** Data harga per lokasi/komoditas. */
export interface PriceRecord {
  locationId: string;
  commodityId: string;
  pricePerKg: number;
  referencePricePerKg: number;
  deviationPercent: number;
}

/** Breakdown Safe Delivered Cost untuk satu kandidat pemasok. */
export interface CandidateCostBreakdown {
  candidateId: string;
  supplierId: string;
  pricePerKg: number;
  transportCostPerKg: number;
  handlingCostPerKg: number;
  spoilageRiskCostPerKg: number;
  /**
   * Komponen freshness risk (Schema.md §3 `cost_breakdown.freshness_risk`).
   * Opsional supaya data lama (mock/backend versi sebelumnya) tetap terbaca;
   * hilangnya komponen ini tidak dianggap 0 diam-diam — lihat lib/cost.ts.
   */
  freshnessRiskCostPerKg?: number;
  safetyPenaltyPerKg: number;
  totalSafeDeliveredCostPerKg: number;
  distanceKm: number;
  etaMinutes: number;
  evidenceCompleteness: number; // 0-100
}

/** Ringkasan bukti yang mendukung satu keputusan. */
export interface EvidenceSummary {
  sap: boolean;
  iot: boolean;
  physical: boolean;
  completenessPercent: number; // 0-100
  inconsistencies: { description: string }[];
}

/** Satu langkah dalam trace agent (sumber: AgentCore Observability). */
export interface AgentStep {
  step: AgentStepName;
  tool?: string;
  /** Nama lama (dipakai versi awal frontend). */
  input?: string;
  /** Nama lama (dipakai versi awal frontend). */
  output?: string;
  /** Nama lama (dipakai versi awal frontend). */
  timestamp: string;
  /** Ringkasan input tool (Schema.md §3 `agent_traces.input_summary`). */
  inputSummary?: string;
  /** Ringkasan output tool (Schema.md §3 `agent_traces.output_summary`). */
  outputSummary?: string;
  /** Durasi langkah dalam ms (Schema.md §3 `agent_traces.duration_ms`). */
  durationMs?: number;
  /** Waktu langkah (Schema.md §3 `agent_traces.step_at`). */
  stepAt?: string;
}

/** Rekomendasi alokasi yang dihasilkan agent. */
export interface Recommendation {
  id: string;
  status: DecisionStatus;
  /** Jenis keputusan (Schema.md §3 `decisions.decision_type`). */
  decisionType: DecisionType;
  sourceLocationId: string;
  targetLocationId: string;
  commodityId: string;
  quantityKg: number;
  safeDeliveredCostBreakdown: CandidateCostBreakdown[];
  evidence: EvidenceSummary;
  /** Bukti per-item untuk Evidence Timeline (design.md §3.3). */
  evidenceItems?: EvidenceItem[];
  /** Hasil hard constraint check per kandidat (design.md §3.3). */
  constraints?: ConstraintCheck[];
  /** Catatan audit Verifier Agent kalau ada flag (design.md §3.3). */
  verifierNote?: string;
  /** Nama agent yang mengaudit, mis. "verifier_agent" (Schema.md §3). */
  verifiedBy?: string;
  safetyCheck: SafetyStatus;
  reason: string;
  createdAt: string;
  approvedAt?: string;
  /**
   * Batas waktu eksekusi (Schema.md §3 `decisions.expires_at`) =
   * min(batch.usable_until, SLA per komoditas). Lewat batas → status `expired`,
   * tidak pernah `executed` (Schema.md §6).
   */
  expiresAt?: string;
  executedAt?: string;
  /**
   * Hasil setelah barang diterima/dicek (Schema.md §3 `decisions.outcome`) —
   * basis mekanisme LEARN (Skill.md §10). NULL/'pending' = belum diperiksa.
   */
  outcome?: "pending" | "success" | "failure";
  /** Purchase order di SAP (mock) yang lahir dari approval keputusan ini. */
  sapPurchaseOrder?: SapPurchaseOrder;
  agentTrace?: AgentStep[];
}

/** Purchase order SAP (mock) — bukti eksekusi aksi yang di-approve. */
export interface SapPurchaseOrder {
  poNumber: string;
  plant: string;
  orderedQuantityKg: number;
  status: "draft" | "submitted" | "confirmed";
}

/** Pengguna yang login. */
export interface User {
  id: string;
  name: string;
  role: Role;
  /** Untuk sppg_staff, lokasi yang menjadi tanggung jawabnya. */
  locationId?: string;
  /**
   * Scope wilayah (region) untuk sppg_head & sppg_nutritionist.
   * Bila diisi, user hanya bisa melihat / approve keputusan di region tersebut.
   */
  region?: string;
  /**
   * true  → user boleh melakukan approve/reject keputusan.
   * false → read-only (bgn_monitor).
   */
  canApprove?: boolean;
}

/** Tujuh indikator kesuksesan (lihat frontend.md). */
export interface KPI {
  mealContinuityRate: number; // 0-100
  avoidableFoodLossKg: number;
  avoidableFoodLossRp: number;
  regionalImbalanceResolutionRate: number; // 0-100
  averageSafeDeliveredCostPerKg: number;
  averageProcurementPriceDeviationPercent: number;
  averageDecisionTimeMinutes: number;
  evidenceCompletenessPercent: number; // 0-100
}

/** Nilai KPI periode sebelumnya — untuk indikator trend (design.md §3.6). */
export type PreviousKpi = Partial<KPI>;

/**
 * KPI + pembanding periode sebelumnya (sumber: `kpi_snapshots` di Schema.md §3,
 * diambil dari `computed_at` terakhir sebelum periode berjalan).
 *
 * Sebagian KPI bisa saja BELUM ada isinya: sumbernya (rencana menu, limbah) memang tidak
 * tersimpan di skema. Field yang tidak ada berarti "belum bisa dihitung" — UI menampilkan "—",
 * dan `unavailable` memuat alasannya. Nilai 0 hanya boleh berarti "nihil kejadian".
 */
export interface KpiSnapshot extends Partial<KPI> {
  previous?: PreviousKpi;
  /** Alasan per KPI yang belum bisa dihitung backend (kunci sama dengan field KPI). */
  unavailable?: Partial<Record<keyof KPI, string>>;
}

/** Pemasok (Schema.md §1 `suppliers`) — skor kepercayaan diperbarui lewat LEARN (Skill.md §10). */
export interface Supplier {
  id: string;
  name: string;
  locationId: string;
  /** 0..1, DEFAULT 0.80 di DB. Disetel deterministik dari `decisions.outcome`, bukan training model. */
  reliabilityScore: number;
}

/** Hasil penerimaan barang (`decisions.outcome`, Schema.md §3). */
export type DeliveryOutcome = "success" | "failure";

/** Satu kejadian penerimaan untuk riwayat reliability pemasok (design.md §3.9c). */
export interface SupplierDeliveryEvent {
  at: string;
  outcome: DeliveryOutcome;
  decisionId: string;
  commodityId: string;
  quantityKg: number;
  note?: string;
}

/** Body Receiving Inspection (design.md §3.5b). */
export interface ReceivingInspectionRequest {
  decisionId: string;
  measuredTempC: number;
  physicalCondition: "baik" | "rusak_sebagian" | "rusak";
  note?: string;
}

/** Hasil Receiving Inspection: evidence `human_inspection` baru + `decisions.outcome` terisi. */
export interface ReceivingInspectionResult {
  decision: Recommendation;
  evidenceId: string;
  outcome: DeliveryOutcome;
  /** true bila `failure` → menurunkan `reliability_score` pemasok (design.md §3.5b). */
  affectsSupplierReliability: boolean;
}

/** Satu titik skor kepercayaan pemasok (hasil replay riwayat, bukan angka baru). */
export interface SupplierScorePoint {
  /** ISO timestamp kejadian; null = titik awal (skor sebelum histori). */
  at: string | null;
  score: number;
  outcome: DeliveryOutcome | null;
  /** true bila titik ini insiden/penurunan — dasar marker di grafik. */
  isIncident: boolean;
  decisionId?: string;
}

/**
 * Riwayat pemasok untuk design.md §3.9c: skor sebelum/sesudah insiden.
 * Dihitung backend dari `suppliers.reliability_score` + riwayat
 * `decisions.outcome` (LEARN, Skill.md §10) — frontend tidak menghitung sendiri.
 */
export interface SupplierHistory {
  supplierId: string;
  currentScore: number;
  points: SupplierScorePoint[];
  events: SupplierDeliveryEvent[];
}

/** Request body untuk login. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** Response login — JWT + profil user. */
export interface LoginResponse {
  token: string;
  user: User;
}

/** Payload JWT setelah decode (untuk cek role di client). */
export interface JwtPayload {
  sub?: string;
  role?: Role;
  locationId?: string;
  /** Scope wilayah untuk sppg_head & sppg_nutritionist. */
  region?: string;
  /** true = boleh approve; false = read-only. */
  canApprove?: boolean;
  exp?: number;
  [key: string]: unknown;
}

/** Request body untuk approve/reject sebuah aksi. */
export interface ApproveRequest {
  decisionId: string;
}

export interface RejectRequest {
  decisionId: string;
  reason: string;
}

/** Struktur error standar backend. */
export interface ApiError {
  detail: string;
}
