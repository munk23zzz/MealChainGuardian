/**
 * Mock data untuk development — dipakai saat NEXT_PUBLIC_USE_MOCK=true
 * atau saat backend tidak tersedia.
 *
 * ATURAN (Rules.md §1.4): semua angka di sini adalah SIMULASI (mock SAP), bukan
 * data SAP asli. UI wajib menampilkan badge "Data Simulasi".
 *
 * Bentuk datanya sengaja mengikuti `docs/Schema.md` — termasuk:
 * - `decisions.status` enum: proposed · verifier_flagged · pending_approval · approved · rejected · executed
 * - `cost_breakdown`: purchase + transport + handling + expected_loss + freshness_risk + safety_penalty
 * - `decision_evidence`: evidence_type, is_consistent, recorded_at
 * - `agent_traces`: tool, input_summary, output_summary, duration_ms, step_at
 *
 * Akun demo:
 *   username: sppg.head@demo.local         | password: Demo#SPPG2026 | role: sppg_head        | region: DKI Jakarta  | canApprove: true
 *   username: sppg.nutritionist@demo.local | password: Demo#Nut2026  | role: sppg_nutritionist | region: Jawa Barat  | canApprove: true
 *   username: bgn.monitor@demo.local       | password: Demo#BGN2026  | role: bgn_monitor       | region: -           | canApprove: false (read-only)
 *
 * Alur demo (design.md §2): Event 1 diwakili dec-001 (regional balance),
 * Event 2 dec-003 (price anomaly), Event 3 dec-002/dec-004 (safety disruption).
 */
import type { ModelSource } from "./agent-log";
import { reliabilitySeries } from "./reliability";
import type { Supplier, SupplierHistory, SupplierDeliveryEvent } from "./api/schema";
import type {
  AgentStep,
  Commodity,
  DemandRecord,
  KPI,
  LoginResponse,
  Location,
  PreviousKpi,
  Recommendation,
  SupplyRecord,
  User,
} from "./api/schema";

// ---------------------------------------------------------------------------
// Helpers — buat JWT palsu (tidak di-sign, hanya untuk demo)
// ---------------------------------------------------------------------------

function base64url(obj: object): string {
  const json = JSON.stringify(obj);
  // btoa hanya tersedia di browser; di Node (next build) pakai Buffer
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(json)
      : Buffer.from(json).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function makeMockJwt(payload: object): string {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const body = base64url(payload);
  // Signature palsu — backend tidak akan memvalidasi ini di mock mode
  const sig = base64url({ mock: true });
  return `${header}.${body}.${sig}`;
}

/** Waktu relatif ke sekarang (menit ke belakang) — supaya demo selalu "hidup". */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/**
 * Waktu relatif ke depan (menit) — untuk `decisions.expires_at` (Schema.md §3),
 * supaya countdown di layar keputusan benar-benar berjalan saat demo.
 */
function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

// sppg_head — Jakarta, bisa approve
export const MOCK_TOKEN_SPPG_HEAD = makeMockJwt({
  sub: "user-sppg-head",
  role: "sppg_head",
  region: "DKI Jakarta",
  canApprove: true,
  exp,
});

// sppg_nutritionist — Bogor, bisa approve
export const MOCK_TOKEN_NUTRITIONIST = makeMockJwt({
  sub: "user-nutritionist",
  role: "sppg_nutritionist",
  region: "Jawa Barat",
  canApprove: true,
  exp,
});

// bgn_monitor — tanpa batasan lokasi, read-only
export const MOCK_TOKEN_BGN = makeMockJwt({
  sub: "user-bgn-monitor",
  role: "bgn_monitor",
  canApprove: false,
  exp,
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const MOCK_USERS: Record<string, { password: string; token: string; user: User }> = {
  "sppg.head@demo.local": {
    password: "Demo#SPPG2026",
    token: MOCK_TOKEN_SPPG_HEAD,
    user: {
      id: "user-sppg-head",
      name: "Kepala SPPG Jakarta",
      role: "sppg_head",
      region: "DKI Jakarta",
      canApprove: true,
    },
  },
  "sppg.nutritionist@demo.local": {
    password: "Demo#Nut2026",
    token: MOCK_TOKEN_NUTRITIONIST,
    user: {
      id: "user-nutritionist",
      name: "Ahli Gizi SPPG Bogor",
      role: "sppg_nutritionist",
      region: "Jawa Barat",
      canApprove: true,
    },
  },
  "bgn.monitor@demo.local": {
    password: "Demo#BGN2026",
    token: MOCK_TOKEN_BGN,
    user: {
      id: "user-bgn-monitor",
      name: "Monitor BGN",
      role: "bgn_monitor",
      canApprove: false,
    },
  },
};

export const MOCK_LOGIN_RESPONSES: Record<string, LoginResponse> = {
  "sppg.head@demo.local": { token: MOCK_TOKEN_SPPG_HEAD,    user: MOCK_USERS["sppg.head@demo.local"].user },
  "sppg.nutritionist@demo.local": { token: MOCK_TOKEN_NUTRITIONIST, user: MOCK_USERS["sppg.nutritionist@demo.local"].user },
  "bgn.monitor@demo.local": { token: MOCK_TOKEN_BGN,        user: MOCK_USERS["bgn.monitor@demo.local"].user },
};

// ---------------------------------------------------------------------------
// Locations — 10 lokasi (design.md §3.1). Cianjur = producer hub (narrative
// proposal: surplus produsen → demand hub Jakarta).
// ---------------------------------------------------------------------------

export const MOCK_LOCATIONS: Location[] = [
  { id: "loc-1",  name: "SPPG Jakarta Pusat",   region: "DKI Jakarta", latitude: -6.1862, longitude: 106.8342, roleHint: "demand_hub",   status: "ok" },
  { id: "loc-2",  name: "SPPG Jakarta Utara",   region: "DKI Jakarta", latitude: -6.1218, longitude: 106.9000, roleHint: "demand_hub",   status: "warning" },
  { id: "loc-3",  name: "SPPG Jakarta Barat",   region: "DKI Jakarta", latitude: -6.1675, longitude: 106.7630, roleHint: "demand_hub",   status: "ok" },
  { id: "loc-4",  name: "SPPG Jakarta Selatan", region: "DKI Jakarta", latitude: -6.2615, longitude: 106.8106, roleHint: "demand_hub",   status: "critical" },
  { id: "loc-5",  name: "SPPG Jakarta Timur",   region: "DKI Jakarta", latitude: -6.2250, longitude: 106.9004, roleHint: "demand_hub",   status: "ok" },
  { id: "loc-6",  name: "SPPG Bogor",           region: "Jawa Barat",  latitude: -6.5971, longitude: 106.8060, roleHint: "mixed",        status: "warning" },
  { id: "loc-7",  name: "SPPG Depok",           region: "Jawa Barat",  latitude: -6.4025, longitude: 106.7942, roleHint: "mixed",        status: "ok" },
  { id: "loc-8",  name: "SPPG Tangerang",       region: "Banten",      latitude: -6.1783, longitude: 106.6319, roleHint: "mixed",        status: "ok" },
  { id: "loc-9",  name: "SPPG Bekasi",          region: "Jawa Barat",  latitude: -6.2383, longitude: 106.9756, roleHint: "mixed",        status: "warning" },
  { id: "loc-10", name: "Gudang Cianjur",       region: "Jawa Barat",  latitude: -6.8168, longitude: 107.1425, roleHint: "producer_hub", status: "ok" },
];

// ---------------------------------------------------------------------------
// Supply Records (mock SAP + sensor)
// ---------------------------------------------------------------------------

export const MOCK_SUPPLY: SupplyRecord[] = [
  { locationId: "loc-1",  commodityId: "com-telur",  physicalStockKg: 1200, usableStockKg: 1100, batchCount: 5, status: "surplus",  pricePerKg: 28000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-1",  commodityId: "com-ayam",   physicalStockKg: 800,  usableStockKg: 750,  batchCount: 3, status: "balanced", pricePerKg: 35000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-1",  commodityId: "com-wortel", physicalStockKg: 500,  usableStockKg: 480,  batchCount: 4, status: "balanced", pricePerKg: 12000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-2",  commodityId: "com-telur",  physicalStockKg: 300,  usableStockKg: 280,  batchCount: 2, status: "deficit",  pricePerKg: 30000, freshnessStatus: "approaching_expiry", safetyStatus: "NEEDS_VERIFICATION", temperatureExcursion: true },
  { locationId: "loc-2",  commodityId: "com-ayam",   physicalStockKg: 200,  usableStockKg: 180,  batchCount: 1, status: "deficit",  pricePerKg: 37000, freshnessStatus: "approaching_expiry", safetyStatus: "PASS" },
  { locationId: "loc-2",  commodityId: "com-wortel", physicalStockKg: 150,  usableStockKg: 140,  batchCount: 2, status: "deficit",  pricePerKg: 13000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-3",  commodityId: "com-telur",  physicalStockKg: 900,  usableStockKg: 880,  batchCount: 4, status: "surplus",  pricePerKg: 27500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-3",  commodityId: "com-ayam",   physicalStockKg: 620,  usableStockKg: 600,  batchCount: 3, status: "surplus",  pricePerKg: 34500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-4",  commodityId: "com-ayam",   physicalStockKg: 50,   usableStockKg: 40,   batchCount: 1, status: "deficit",  pricePerKg: 40000, freshnessStatus: "expired",            safetyStatus: "FAIL" },
  { locationId: "loc-5",  commodityId: "com-wortel", physicalStockKg: 700,  usableStockKg: 680,  batchCount: 3, status: "surplus",  pricePerKg: 11500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-6",  commodityId: "com-telur",  physicalStockKg: 400,  usableStockKg: 380,  batchCount: 2, status: "balanced", pricePerKg: 29000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-6",  commodityId: "com-wortel", physicalStockKg: 120,  usableStockKg: 110,  batchCount: 1, status: "deficit",  pricePerKg: 14000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-7",  commodityId: "com-telur",  physicalStockKg: 620,  usableStockKg: 600,  batchCount: 3, status: "balanced", pricePerKg: 27500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-7",  commodityId: "com-wortel", physicalStockKg: 540,  usableStockKg: 520,  batchCount: 2, status: "surplus",  pricePerKg: 11000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-8",  commodityId: "com-ayam",   physicalStockKg: 450,  usableStockKg: 430,  batchCount: 2, status: "balanced", pricePerKg: 35000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-8",  commodityId: "com-telur",  physicalStockKg: 300,  usableStockKg: 285,  batchCount: 2, status: "deficit",  pricePerKg: 29500, freshnessStatus: "approaching_expiry", safetyStatus: "PASS" },
  { locationId: "loc-9",  commodityId: "com-telur",  physicalStockKg: 260,  usableStockKg: 240,  batchCount: 2, status: "deficit",  pricePerKg: 31000, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-9",  commodityId: "com-ayam",   physicalStockKg: 180,  usableStockKg: 170,  batchCount: 1, status: "deficit",  pricePerKg: 36500, freshnessStatus: "approaching_expiry", safetyStatus: "PASS" },
  { locationId: "loc-10", commodityId: "com-telur",  physicalStockKg: 2400, usableStockKg: 2300, batchCount: 8, status: "surplus",  pricePerKg: 25500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
  { locationId: "loc-10", commodityId: "com-wortel", physicalStockKg: 1600, usableStockKg: 1520, batchCount: 6, status: "surplus",  pricePerKg: 10500, freshnessStatus: "fresh",              safetyStatus: "PASS" },
];

// ---------------------------------------------------------------------------
// Demand Records
// ---------------------------------------------------------------------------

export const MOCK_DEMAND: DemandRecord[] = [
  { locationId: "loc-1",  commodityId: "com-telur",  projectedKg: 900,  deficitKg: 0,   surplusKg: 200 },
  { locationId: "loc-1",  commodityId: "com-ayam",   projectedKg: 800,  deficitKg: 0,   surplusKg: 0   },
  { locationId: "loc-2",  commodityId: "com-telur",  projectedKg: 500,  deficitKg: 220, surplusKg: 0   },
  { locationId: "loc-2",  commodityId: "com-ayam",   projectedKg: 300,  deficitKg: 120, surplusKg: 0   },
  { locationId: "loc-4",  commodityId: "com-ayam",   projectedKg: 400,  deficitKg: 360, surplusKg: 0   },
  { locationId: "loc-5",  commodityId: "com-wortel", projectedKg: 500,  deficitKg: 0,   surplusKg: 180 },
  { locationId: "loc-6",  commodityId: "com-wortel", projectedKg: 250,  deficitKg: 140, surplusKg: 0   },
  { locationId: "loc-7",  commodityId: "com-telur",  projectedKg: 700,  deficitKg: 0,   surplusKg: 80  },
  { locationId: "loc-8",  commodityId: "com-telur",  projectedKg: 420,  deficitKg: 140, surplusKg: 0   },
  { locationId: "loc-9",  commodityId: "com-telur",  projectedKg: 400,  deficitKg: 160, surplusKg: 0   },
  { locationId: "loc-9",  commodityId: "com-ayam",   projectedKg: 420,  deficitKg: 250, surplusKg: 0   },
];

// ---------------------------------------------------------------------------
// Recommendations / Decisions
// ---------------------------------------------------------------------------

/** Trace 8 langkah (DETECT → LEARN) — mengikuti tool contract di Skill.md §5.
 *
 * `forecastSource` menunjukkan provider yang benar-benar dipakai model prakiraan
 * demand: suffix `[primary]`/`[fallback_1]`/`[fallback_2]` wajib ada (Schema.md
 * §6 + Architecture.md §10.4) supaya pemakaian fallback terlihat di Agent Log
 * (design.md §3.4b) — bukan disembunyikan.
 */
function fullTrace(
  startedMinutesAgo: number,
  forecastSource: ModelSource = "primary",
): AgentStep[] {
  const at = (offset: number) => minutesAgo(startedMinutesAgo - offset);
  return [
    {
      step: "DETECT",
      tool: "supply.get",
      inputSummary: "{ location_id: 'loc-2', commodity_id: 'com-telur' }",
      outputSummary: "{ usable_kg: 280, demand_kg: 500, deficit_kg: 220 }",
      durationMs: 412,
      stepAt: at(0),
      timestamp: at(0),
    },
    {
      step: "VERIFY",
      tool: "safety.evaluate",
      inputSummary: "{ batch_id: 'BATCH-2291' }",
      outputSummary: "{ safety_status: 'PASS', reasons: [] }",
      durationMs: 356,
      stepAt: at(1),
      timestamp: at(1),
    },
    {
      step: "TRACE",
      tool: "evidence.fuse",
      inputSummary: "{ decision_id: 'candidate-set' }",
      outputSummary: "{ overall_consistent: true, evidences: 4 }",
      durationMs: 905,
      stepAt: at(2),
      timestamp: at(2),
    },
    {
      step: "PREDICT",
      tool: `demand.forecast[${forecastSource}]`,
      inputSummary:
        "{ location_id: 'loc-2', commodity_id: 'com-telur', horizon_days: 2 }",
      outputSummary: "{ forecast_demand_kg: 500, method: 'moving_average_7d' }",
      durationMs: 288,
      stepAt: at(3),
      timestamp: at(3),
    },
    {
      step: "OPTIMIZE",
      tool: "cost.safe_delivered",
      inputSummary: "{ candidates: 2 }",
      outputSummary: "{ best_total_per_kg: 26100, candidates_evaluated: 2 }",
      durationMs: 1240,
      stepAt: at(4),
      timestamp: at(4),
    },
    {
      step: "DECIDE",
      tool: "balance.recommend",
      inputSummary: "{ location_id: 'loc-2', commodity_id: 'com-telur' }",
      outputSummary: "{ recommended_candidate: 'SUP-001' }",
      durationMs: 630,
      stepAt: at(5),
      timestamp: at(5),
    },
    {
      step: "ACT",
      tool: "actions.propose",
      inputSummary: "{ decision_id: 'auto' }",
      outputSummary: "{ status: 'pending_approval' }",
      durationMs: 190,
      stepAt: at(6),
      timestamp: at(6),
    },
    {
      step: "LEARN",
      tool: "kpi.snapshot",
      inputSummary: "{ scope: 'global' }",
      outputSummary: "{ decision_time_min: 18, evidence_completeness_pct: 89 }",
      durationMs: 240,
      stepAt: at(7),
      timestamp: at(7),
    },
  ];
}

export const MOCK_DECISIONS: Recommendation[] = [
  {
    // Event 1 (design.md §2): regional balance, Cianjur → Jakarta Utara
    id: "dec-001",
    status: "pending_approval",
    decisionType: "regional_balance",
    sourceLocationId: "loc-10",
    targetLocationId: "loc-2",
    commodityId: "com-telur",
    quantityKg: 200,
    safetyCheck: "PASS",
    reason:
      "Jakarta Utara defisit 220 kg telur untuk distribusi MBG 2 hari ke depan. Gudang Cianjur punya surplus 2.300 kg dengan harga dan jarak paling efisien; total Safe Delivered Cost Rp 26.100/kg.",
    createdAt: minutesAgo(24),
    // Countdown demo: masih lega (>2 jam) — design.md §3.3.
    expiresAt: minutesFromNow(130),
    evidence: {
      sap: true,
      iot: true,
      physical: true,
      completenessPercent: 95,
      inconsistencies: [],
    },
    evidenceItems: [
      {
        id: "ev-001-1",
        type: "sap_purchase_order",
        source: "SAP PO 4500001234 (mock)",
        summary: "PO telur 200 kg untuk plant loc-2, status confirmed.",
        recordedAt: minutesAgo(70),
        isConsistent: true,
      },
      {
        id: "ev-001-2",
        type: "sap_goods_receipt",
        source: "SAP goods receipt 5000000987 (mock)",
        summary: "Penerimaan batch BATCH-4471 di gudang Cianjur.",
        recordedAt: minutesAgo(64),
        isConsistent: true,
      },
      {
        id: "ev-001-3",
        type: "temperature",
        source: "Sensor IoT CIANJUR-COLD-03",
        summary: "Suhu chiller stabil 2-4 °C selama 24 jam terakhir.",
        recordedAt: minutesAgo(45),
        isConsistent: true,
      },
      {
        id: "ev-001-4",
        type: "human_inspection",
        source: "Inspeksi petugas SPPG #112",
        summary: "Cangkang utuh, tidak ada bau menyimpang.",
        recordedAt: minutesAgo(38),
        isConsistent: true,
      },
    ],
    constraints: [
      {
        name: "safety_eligibility",
        passed: true,
        detail: "safety_status PASS untuk semua batch kandidat.",
      },
      {
        name: "freshness_threshold",
        passed: true,
        detail: "freshness_score 0.82 ≥ ambang 0.6.",
      },
      {
        name: "capacity",
        passed: true,
        detail: "Kapasitas angkut 1.200 kg > kebutuhan 200 kg.",
      },
      {
        name: "delivery_window",
        passed: true,
        detail: "ETA 165 menit, jendela pengiriman 8 jam.",
      },
    ],
    verifiedBy: "verifier_agent",
    safeDeliveredCostBreakdown: [
      {
        candidateId: "cand-001-a",
        supplierId: "SUP-001 · Koperasi Cianjur",
        pricePerKg: 25500,
        transportCostPerKg: 900,
        handlingCostPerKg: 200,
        spoilageRiskCostPerKg: 180,
        freshnessRiskCostPerKg: 120,
        safetyPenaltyPerKg: 0,
        totalSafeDeliveredCostPerKg: 26900,
        distanceKm: 92,
        etaMinutes: 165,
        evidenceCompleteness: 95,
      },
      {
        candidateId: "cand-001-b",
        supplierId: "SUP-004 · Pasar Induk Bogor",
        pricePerKg: 26800,
        transportCostPerKg: 700,
        handlingCostPerKg: 220,
        spoilageRiskCostPerKg: 240,
        freshnessRiskCostPerKg: 160,
        safetyPenaltyPerKg: 0,
        totalSafeDeliveredCostPerKg: 28120,
        distanceKm: 58,
        etaMinutes: 120,
        evidenceCompleteness: 88,
      },
    ],
    agentTrace: fullTrace(24),
  },
  {
    // Event 3 (bagian pertama): safety disruption → perlu verifikasi manusia
    id: "dec-002",
    status: "verifier_flagged",
    decisionType: "safety_disruption",
    sourceLocationId: "loc-3",
    targetLocationId: "loc-4",
    commodityId: "com-ayam",
    quantityKg: 150,
    safetyCheck: "NEEDS_VERIFICATION",
    reason:
      "Stok ayam Jakarta Selatan kritis (usable 40 kg dari 50 kg fisik; satu batch FAIL karena kedaluwarsa). Kandidat Jakarta Barat lolos safety, tapi bukti IoT untuk lokasi tujuan tidak tersedia sehingga Verifier meminta verifikasi manusia.",
    createdAt: minutesAgo(58),
    // Mendesak (di bawah 2 jam) + butuh 2 approval → cerita "decision time".
    expiresAt: minutesFromNow(26),
    evidence: {
      sap: true,
      iot: false,
      physical: true,
      completenessPercent: 72,
      inconsistencies: [{ description: "Data IoT loc-4 tidak tersedia (sensor offline)" }],
    },
    evidenceItems: [
      {
        id: "ev-002-1",
        type: "sap_purchase_order",
        source: "SAP PO 4500001301 (mock)",
        summary: "PO ayam 150 kg untuk plant loc-4.",
        recordedAt: minutesAgo(120),
        isConsistent: true,
      },
      {
        id: "ev-002-2",
        type: "gps",
        source: "GPS truk B-9031-KD",
        summary: "Rute Jakarta Barat → Jakarta Selatan, 18 km.",
        recordedAt: minutesAgo(96),
        isConsistent: true,
      },
      {
        id: "ev-002-3",
        type: "temperature",
        source: "Sensor IoT JKT-SELATAN-COLD-02",
        summary: "Sensor offline sejak 6 jam lalu, tidak ada pembacaan.",
        recordedAt: minutesAgo(360),
        isConsistent: false,
      },
      {
        id: "ev-002-4",
        type: "human_inspection",
        source: "Inspeksi petugas SPPG #207",
        summary: "Belum dilakukan — menunggu jadwal pagi.",
        recordedAt: minutesAgo(90),
        isConsistent: null,
      },
    ],
    constraints: [
      {
        name: "safety_eligibility",
        passed: true,
        detail: "Batch kandidat PASS; batch FAIL loc-4 otomatis dikeluarkan.",
      },
      {
        name: "freshness_threshold",
        passed: true,
        detail: "freshness_score 0.68 ≥ ambang 0.6.",
      },
      { name: "capacity", passed: true, detail: "Kapasitas 800 kg > 150 kg." },
      {
        name: "delivery_window",
        passed: true,
        detail: "ETA 60 menit, jendela 4 jam.",
      },
    ],
    verifierNote:
      "Bukti IoT lokasi tujuan tidak lengkap dan konsistensi suhu tidak bisa diverifikasi. Kandidat tetap ditampilkan, tetapi butuh verifikasi manusia sebelum approve (bukan auto-execute).",
    verifiedBy: "verifier_agent",
    safeDeliveredCostBreakdown: [
      {
        candidateId: "cand-002-a",
        supplierId: "SUP-002 · Distributor Jakarta Barat",
        pricePerKg: 34500,
        transportCostPerKg: 1200,
        handlingCostPerKg: 300,
        spoilageRiskCostPerKg: 420,
        freshnessRiskCostPerKg: 260,
        safetyPenaltyPerKg: 1000,
        totalSafeDeliveredCostPerKg: 37680,
        distanceKm: 18,
        etaMinutes: 60,
        evidenceCompleteness: 72,
      },
    ],
    agentTrace: fullTrace(58, "fallback_1"),
  },
  {
    // Event 2: price anomaly (harga pasar menyimpang dari referensi)
    id: "dec-003",
    status: "approved",
    decisionType: "price_anomaly",
    sourceLocationId: "loc-5",
    targetLocationId: "loc-6",
    commodityId: "com-wortel",
    quantityKg: 180,
    safetyCheck: "PASS",
    reason:
      "Harga wortel di Bogor naik 18,4% dari referensi PIHPS. Redistribusi surplus wortel Jakarta Timur (Rp 11.500/kg) menekan biaya ke Rp 13.020/kg.",
    createdAt: minutesAgo(180),
    approvedAt: minutesAgo(150),
    evidence: {
      sap: true,
      iot: true,
      physical: true,
      completenessPercent: 100,
      inconsistencies: [],
    },
    evidenceItems: [
      {
        id: "ev-003-1",
        type: "market_price",
        source: "PIHPS referensi Jawa Barat",
        summary: "Harga referensi wortel Rp 12.000/kg; penawaran Bogor Rp 14.200/kg.",
        recordedAt: minutesAgo(240),
        isConsistent: true,
      },
      {
        id: "ev-003-2",
        type: "sap_purchase_order",
        source: "SAP PO 4500001288 (mock)",
        summary: "PO wortel 180 kg plant loc-6.",
        recordedAt: minutesAgo(200),
        isConsistent: true,
      },
      {
        id: "ev-003-3",
        type: "temperature",
        source: "Sensor IoT JKT-TIMUR-COLD-01",
        summary: "Suhu 4,1 °C, dalam rentang aman.",
        recordedAt: minutesAgo(190),
        isConsistent: true,
      },
      {
        id: "ev-003-4",
        type: "human_inspection",
        source: "Inspeksi petugas SPPG #145",
        summary: "Wortel keras, warna merata, tidak ada luka.",
        recordedAt: minutesAgo(185),
        isConsistent: true,
      },
    ],
    constraints: [
      { name: "safety_eligibility", passed: true, detail: "Semua batch PASS." },
      { name: "freshness_threshold", passed: true, detail: "freshness_score 0.79." },
      { name: "capacity", passed: true, detail: "Kapasitas 900 kg > 180 kg." },
      { name: "delivery_window", passed: true, detail: "ETA 90 menit." },
    ],
    sapPurchaseOrder: {
      poNumber: "4500001288",
      plant: "loc-6",
      orderedQuantityKg: 180,
      status: "submitted",
    },
    verifiedBy: "verifier_agent",
    safeDeliveredCostBreakdown: [
      {
        candidateId: "cand-003-a",
        supplierId: "SUP-005 · Pasar Induk Kramat Jati",
        pricePerKg: 11500,
        transportCostPerKg: 1000,
        handlingCostPerKg: 250,
        spoilageRiskCostPerKg: 150,
        freshnessRiskCostPerKg: 120,
        safetyPenaltyPerKg: 0,
        totalSafeDeliveredCostPerKg: 13020,
        distanceKm: 55,
        etaMinutes: 90,
        evidenceCompleteness: 100,
      },
      {
        candidateId: "cand-003-b",
        supplierId: "SUP-006 · Supplier Bogor lokal",
        pricePerKg: 14200,
        transportCostPerKg: 300,
        handlingCostPerKg: 200,
        spoilageRiskCostPerKg: 180,
        freshnessRiskCostPerKg: 140,
        safetyPenaltyPerKg: 0,
        totalSafeDeliveredCostPerKg: 15020,
        distanceKm: 8,
        etaMinutes: 25,
        evidenceCompleteness: 76,
      },
    ],
    agentTrace: fullTrace(180),
  },
  {
    // Event 3 (bagian kedua): kandidat gugur hard constraint → ditolak
    id: "dec-004",
    status: "rejected",
    decisionType: "safety_disruption",
    sourceLocationId: "loc-2",
    targetLocationId: "loc-9",
    commodityId: "com-telur",
    quantityKg: 100,
    safetyCheck: "FAIL",
    reason:
      "Stok telur Jakarta Utara mengalami temperature excursion (rantai dingin terputus 4 jam). Batch gagal safety check sehingga tidak layak dialokasikan — kandidat ini gugur dan tidak muncul sebagai opsi.",
    createdAt: minutesAgo(300),
    // Sudah lewat batas → badge "Kedaluwarsa" (Schema.md §6: tidak pernah executed).
    expiresAt: minutesAgo(60),
    evidence: {
      sap: true,
      iot: true,
      physical: false,
      completenessPercent: 60,
      inconsistencies: [{ description: "Suhu rantai dingin terputus selama 4 jam" }],
    },
    evidenceItems: [
      {
        id: "ev-004-1",
        type: "temperature",
        source: "Sensor IoT JKT-UTARA-COLD-04",
        summary: "Suhu naik ke 11,8 °C selama 4 jam (ambang 8 °C).",
        recordedAt: minutesAgo(330),
        isConsistent: true,
      },
      {
        id: "ev-004-2",
        type: "gps",
        source: "GPS truk B-8890-TR",
        summary: "Truk berhenti 4 jam tanpa daya pendingin.",
        recordedAt: minutesAgo(320),
        isConsistent: true,
      },
      {
        id: "ev-004-3",
        type: "human_inspection",
        source: "Inspeksi petugas SPPG #301",
        summary: "Inspeksi fisik tidak dilanjutkan karena batch sudah gagal safety.",
        recordedAt: minutesAgo(310),
        isConsistent: null,
      },
    ],
    constraints: [
      {
        name: "safety_eligibility",
        passed: false,
        detail: "safety_status FAIL (temperature excursion).",
      },
      { name: "freshness_threshold", passed: false, detail: "freshness_score 0.31." },
      { name: "capacity", passed: true, detail: "Kapasitas cukup." },
      { name: "delivery_window", passed: true, detail: "ETA 75 menit." },
    ],
    verifierNote:
      "Batch tidak eligible. Tidak ada jalur untuk override status safety — keputusan dialihkan ke pengadaan ulang, bukan redistribusi.",
    verifiedBy: "verifier_agent",
    safeDeliveredCostBreakdown: [],
    agentTrace: fullTrace(300),
  },
  {
    // Keputusan yang sudah dieksekusi (menunjukkan status akhir + PO SAP)
    id: "dec-005",
    status: "executed",
    decisionType: "regional_balance",
    sourceLocationId: "loc-3",
    targetLocationId: "loc-9",
    commodityId: "com-ayam",
    quantityKg: 250,
    safetyCheck: "PASS",
    reason:
      "Bekasi defisit 250 kg ayam. Surplus Jakarta Barat dialokasikan dan sudah dieksekusi lewat purchase order SAP (mock).",
    createdAt: minutesAgo(600),
    approvedAt: minutesAgo(560),
    executedAt: minutesAgo(520),
    evidence: {
      sap: true,
      iot: true,
      physical: true,
      completenessPercent: 98,
      inconsistencies: [],
    },
    evidenceItems: [
      {
        id: "ev-005-1",
        type: "sap_goods_receipt",
        source: "SAP goods receipt 5000001042 (mock)",
        summary: "Penerimaan 250 kg ayam di plant loc-9.",
        recordedAt: minutesAgo(500),
        isConsistent: true,
      },
      {
        id: "ev-005-2",
        type: "temperature",
        source: "Sensor IoT JKT-BARAT-COLD-01",
        summary: "Suhu 0,8 °C sepanjang pengiriman.",
        recordedAt: minutesAgo(540),
        isConsistent: true,
      },
    ],
    constraints: [
      { name: "safety_eligibility", passed: true, detail: "Semua batch PASS." },
      { name: "freshness_threshold", passed: true, detail: "freshness_score 0.71." },
      { name: "capacity", passed: true, detail: "Kapasitas 1.000 kg > 250 kg." },
      { name: "delivery_window", passed: true, detail: "ETA 95 menit." },
    ],
    sapPurchaseOrder: {
      poNumber: "4500001265",
      plant: "loc-9",
      orderedQuantityKg: 250,
      status: "confirmed",
    },
    verifiedBy: "verifier_agent",
    safeDeliveredCostBreakdown: [
      {
        candidateId: "cand-005-a",
        supplierId: "SUP-003 · Distributor Jakarta Barat",
        pricePerKg: 34500,
        transportCostPerKg: 1100,
        handlingCostPerKg: 280,
        spoilageRiskCostPerKg: 300,
        freshnessRiskCostPerKg: 210,
        safetyPenaltyPerKg: 0,
        totalSafeDeliveredCostPerKg: 36390,
        distanceKm: 34,
        etaMinutes: 95,
        evidenceCompleteness: 98,
      },
    ],
    agentTrace: fullTrace(600),
  },
];

// ---------------------------------------------------------------------------
// KPI — nilai periode berjalan + periode sebelumnya (untuk trend, design.md §3.6)
// ---------------------------------------------------------------------------

export const MOCK_KPI: KPI = {
  mealContinuityRate: 94.7,
  avoidableFoodLossKg: 320,
  avoidableFoodLossRp: 9_600_000,
  regionalImbalanceResolutionRate: 88.2,
  averageSafeDeliveredCostPerKg: 27_500,
  averageProcurementPriceDeviationPercent: 3.4,
  averageDecisionTimeMinutes: 18,
  evidenceCompletenessPercent: 89,
};

/** Snapshot periode sebelumnya (asal: tabel kpi_snapshots). */
export const MOCK_KPI_PREVIOUS: PreviousKpi = {
  mealContinuityRate: 92.1,
  avoidableFoodLossKg: 410,
  avoidableFoodLossRp: 12_300_000,
  regionalImbalanceResolutionRate: 84.0,
  averageSafeDeliveredCostPerKg: 28_400,
  averageProcurementPriceDeviationPercent: 4.1,
  averageDecisionTimeMinutes: 26,
  evidenceCompletenessPercent: 76,
};

// ---------------------------------------------------------------------------
// Pemasok + riwayat penerimaan (design.md §3.9c, Schema.md §1 `suppliers`)
// ---------------------------------------------------------------------------
/**
 * Skor SEBELUM histori yang kita miliki. Bukan angka baru: Schema.md §1
 * (`suppliers.reliability_score` DEFAULT 0.80) dan pemasok lama memang sudah
 * punya riwayat lebih panjang sebelum keputusan yang ada di feed.
 */
const SUPPLIER_BASE_SCORES: Record<string, number> = {
  "SUP-001": 0.8,
  "SUP-002": 0.85,
  "SUP-003": 0.88,
  "SUP-004": 0.92,
  "SUP-005": 0.8,
  "SUP-006": 0.75,
};

/** Nama & lokasi asal pemasok — id-nya sama dengan yang dipakai label kandidat di keputusan. */
const SUPPLIER_PROFILES: Record<string, { name: string; locationId: string }> = {
  "SUP-001": { name: "Koperasi Cianjur", locationId: "loc-10" },
  "SUP-002": { name: "Distributor Jakarta Barat", locationId: "loc-3" },
  "SUP-003": { name: "Distributor Jakarta Barat", locationId: "loc-3" },
  "SUP-004": { name: "Pasar Induk Bogor", locationId: "loc-6" },
  "SUP-005": { name: "Pasar Induk Kramat Jati", locationId: "loc-5" },
  "SUP-006": { name: "Supplier Bogor lokal", locationId: "loc-6" },
};

/**
 * Riwayat penerimaan per pemasok (basis LEARN, Skill.md §10).
 * `dec-090`..`dec-107` adalah keputusan lama di luar feed aktif — riwayat inilah
 * yang membuat SUP-001 Koperasi Cianjur turun setelah dua insiden suhu, dan itu
 * yang membuatnya kalah dari SUP-004 di keputusan BERIKUTNYA (narasi Skill.md §11).
 */
export const MOCK_SUPPLIER_EVENTS: Record<string, SupplierDeliveryEvent[]> = {
  "SUP-001": [
    { at: "2026-09-22T09:10:00.000Z", outcome: "success", decisionId: "dec-090", commodityId: "com-telur", quantityKg: 120 },
    { at: "2026-09-25T09:05:00.000Z", outcome: "success", decisionId: "dec-091", commodityId: "com-telur", quantityKg: 140 },
    { at: "2026-09-28T09:20:00.000Z", outcome: "success", decisionId: "dec-092", commodityId: "com-ayam", quantityKg: 90 },
    { at: "2026-10-01T09:00:00.000Z", outcome: "failure", decisionId: "dec-093", commodityId: "com-telur", quantityKg: 130, note: "Suhu tiba 9,4 °C (di atas ambang 8 °C)" },
    { at: "2026-10-05T09:15:00.000Z", outcome: "success", decisionId: "dec-094", commodityId: "com-telur", quantityKg: 110 },
    { at: "2026-10-07T02:35:00.000Z", outcome: "failure", decisionId: "dec-095", commodityId: "com-telur", quantityKg: 150, note: "Temperature excursion 6 jam — batch dinyatakan FAIL" },
  ],
  "SUP-002": [
    { at: "2026-09-30T08:40:00.000Z", outcome: "success", decisionId: "dec-096", commodityId: "com-telur", quantityKg: 150 },
    { at: "2026-10-04T08:45:00.000Z", outcome: "success", decisionId: "dec-097", commodityId: "com-telur", quantityKg: 130 },
  ],
  "SUP-003": [
    { at: "2026-09-20T07:55:00.000Z", outcome: "success", decisionId: "dec-098", commodityId: "com-wortel", quantityKg: 200 },
    { at: "2026-09-27T08:10:00.000Z", outcome: "success", decisionId: "dec-099", commodityId: "com-wortel", quantityKg: 180 },
    { at: "2026-10-03T08:05:00.000Z", outcome: "success", decisionId: "dec-100", commodityId: "com-ayam", quantityKg: 160 },
  ],
  "SUP-004": [
    { at: "2026-09-24T08:30:00.000Z", outcome: "success", decisionId: "dec-101", commodityId: "com-telur", quantityKg: 140 },
    { at: "2026-09-29T08:25:00.000Z", outcome: "success", decisionId: "dec-102", commodityId: "com-wortel", quantityKg: 175 },
    { at: "2026-10-06T08:35:00.000Z", outcome: "success", decisionId: "dec-103", commodityId: "com-telur", quantityKg: 120 },
  ],
  "SUP-005": [
    { at: "2026-09-26T08:50:00.000Z", outcome: "success", decisionId: "dec-104", commodityId: "com-ayam", quantityKg: 150 },
    { at: "2026-10-02T09:25:00.000Z", outcome: "failure", decisionId: "dec-105", commodityId: "com-ayam", quantityKg: 145, note: "Rusak sebagian 12 kg saat bongkar muat" },
  ],
  "SUP-006": [
    { at: "2026-09-23T08:15:00.000Z", outcome: "success", decisionId: "dec-106", commodityId: "com-wortel", quantityKg: 95 },
    { at: "2026-10-06T08:20:00.000Z", outcome: "success", decisionId: "dec-107", commodityId: "com-telur", quantityKg: 100 },
  ],
};

/**
 * `reliability_score` DIHITUNG dari riwayat di atas lewat replay LEARN yang sama
 * dengan yang dipakai UI (`lib/reliability.ts`) — satu sumber, tidak ada angka
 * yang diketik dua kali dan bisa jadi tidak sinkron.
 */
export const MOCK_SUPPLIERS: Supplier[] = Object.keys(SUPPLIER_PROFILES).map((id) => {
  const events = MOCK_SUPPLIER_EVENTS[id] ?? [];
  const series = reliabilitySeries(SUPPLIER_BASE_SCORES[id] ?? 0.8, events);
  return {
    id,
    name: SUPPLIER_PROFILES[id].name,
    locationId: SUPPLIER_PROFILES[id].locationId,
    reliabilityScore: series[series.length - 1].score,
  };
});

/**
 * Riwayat pemasok untuk layar §3.9c. Replay memakai fungsi yang sama dengan
 * LEARN di produksi, jadi grafik "sebelum/sesudah insiden" tidak bisa berbohong.
 * Skor terkini di `MOCK_SUPPLIERS` disegarkan dari hasil replay (satu sumber).
 */
export function mockSupplierHistory(supplierId: string): SupplierHistory | null {
  const profile = SUPPLIER_PROFILES[supplierId];
  if (!profile) return null;
  const events = MOCK_SUPPLIER_EVENTS[supplierId] ?? [];
  const points = reliabilitySeries(SUPPLIER_BASE_SCORES[supplierId] ?? 0.8, events);
  const currentScore = points[points.length - 1].score;
  const supplier = MOCK_SUPPLIERS.find((s) => s.id === supplierId);
  if (supplier) supplier.reliabilityScore = currentScore;
  return { supplierId, currentScore, points, events };
}

// ---------------------------------------------------------------------------
// Commodities — 3 komoditas yang di-scope untuk demo
// ---------------------------------------------------------------------------

export const MOCK_COMMODITIES: Commodity[] = [
  { id: "com-telur", name: "telur", unit: "kg" },
  { id: "com-ayam", name: "ayam", unit: "kg" },
  { id: "com-wortel", name: "wortel", unit: "kg" },
];
