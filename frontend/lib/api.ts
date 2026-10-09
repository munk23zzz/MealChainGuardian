/**
 * API client — satu-satunya tempat fetch ke backend. Base URL dari
 * NEXT_PUBLIC_API_BASE_URL, fallback ke localhost:8000 (FastAPI default).
 * Header Authorization diinject dari token yang disimpan di localStorage.
 *
 * MOCK MODE: set NEXT_PUBLIC_USE_MOCK=true di .env.local untuk jalan
 * tanpa backend. Akun: admin/admin (dinas_admin) atau staff/staff (sppg_staff).
 */
import type {
  LoginRequest,
  LoginResponse,
  User,
  SupplyRecord,
  DemandRecord,
  Commodity,
  KpiSnapshot,
  Recommendation,
  Location,
  DeliveryOutcome,
  EvidenceItem,
  ReceivingInspectionRequest,
  ReceivingInspectionResult,
  Supplier,
  SupplierHistory,
} from "./api/schema";
import { applyLearn, parseSupplierId } from "./reliability";
import { getWinningCandidate } from "./decisions";
import {
  MOCK_USERS,
  MOCK_LOCATIONS,
  MOCK_COMMODITIES,
  MOCK_SUPPLY,
  MOCK_DEMAND,
  MOCK_DECISIONS,
  MOCK_KPI,
  MOCK_KPI_PREVIOUS,
  MOCK_SUPPLIERS,
  MOCK_SUPPLIER_EVENTS,
  mockSupplierHistory,
} from "./mock-data";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/** Aktifkan mock mode lewat env var atau fallback otomatis. */
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";

export const TOKEN_STORAGE_KEY = "mealchain.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // non-JSON error body — pakai statusText.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Simulasi delay jaringan ringan agar terasa realistis. */
function mockDelay<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** State decisions in-memory agar approve/reject bisa persist selama sesi. */
const mockDecisions = [...MOCK_DECISIONS];

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export function login(credentials: LoginRequest): Promise<LoginResponse> {
  if (USE_MOCK) {
    const entry = MOCK_USERS[credentials.username];
    if (entry && entry.password === credentials.password) {
      return mockDelay({ token: entry.token, user: entry.user });
    }
    return Promise.reject(new Error("Username atau password salah"));
  }
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function getMe(): Promise<User> {
  if (USE_MOCK) {
    const token = getToken();
    for (const entry of Object.values(MOCK_USERS)) {
      if (entry.token === token) return mockDelay(entry.user);
    }
    return Promise.reject(new Error("Unauthorized"));
  }
  return request<User>("/auth/me");
}

export function getLocations(): Promise<Location[]> {
  if (USE_MOCK) return mockDelay(MOCK_LOCATIONS);
  return request<Location[]>("/ui/locations");
}

export function getCommodities(): Promise<Commodity[]> {
  if (USE_MOCK) return mockDelay(MOCK_COMMODITIES);
  return request<Commodity[]>("/ui/commodities");
}

export function getSupply(): Promise<SupplyRecord[]> {
  if (USE_MOCK) return mockDelay(MOCK_SUPPLY);
  return request<SupplyRecord[]>("/ui/supply");
}

export function getDemand(): Promise<DemandRecord[]> {
  if (USE_MOCK) return mockDelay(MOCK_DEMAND);
  return request<DemandRecord[]>("/ui/demand");
}

export function getDecisions(): Promise<Recommendation[]> {
  if (USE_MOCK) return mockDelay([...mockDecisions]);
  return request<Recommendation[]>("/ui/decisions");
}

export function getDecision(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    const found = mockDecisions.find((d) => d.id === id);
    if (found) return mockDelay({ ...found });
    return Promise.reject(new Error("Decision tidak ditemukan"));
  }
  return request<Recommendation>(`/ui/decisions/${id}`);
}

/**
 * Approve (design.md §3.5) — di mock mode ini juga membuat purchase order SAP
 * palsu supaya alur approve → SAP PO bisa didemokan tanpa backend.
 * Di backend nyata, approve menulis baris `approvals` dulu (Rules.md §1.2).
 */
export function approveDecision(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    const idx = mockDecisions.findIndex((d) => d.id === id);
    if (idx === -1) return Promise.reject(new Error("Decision tidak ditemukan"));
    const decision = mockDecisions[idx];
    if (decision.status === "approved" || decision.status === "executed") {
      return mockDelay({ ...decision });
    }
    mockDecisions[idx] = {
      ...decision,
      status: "approved",
      approvedAt: new Date().toISOString(),
      sapPurchaseOrder: decision.sapPurchaseOrder ?? {
        poNumber: `450000${Math.floor(1000 + Math.random() * 8999)}`,
        plant: decision.targetLocationId,
        orderedQuantityKg: decision.quantityKg,
        status: "submitted",
      },
    };
    return mockDelay({ ...mockDecisions[idx] });
  }
  return request<Recommendation>("/actions/approve", {
    method: "POST",
    body: JSON.stringify({ decisionId: id }),
  });
}

/** Eksekusi keputusan yang sudah di-approve (status → executed + PO confirmed). */
export function executeDecision(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    const idx = mockDecisions.findIndex((d) => d.id === id);
    if (idx === -1) return Promise.reject(new Error("Decision tidak ditemukan"));
    const decision = mockDecisions[idx];
    if (decision.status !== "approved") {
      return Promise.reject(
        new Error("Hanya keputusan yang sudah di-approve yang bisa dieksekusi"),
      );
    }
    mockDecisions[idx] = {
      ...decision,
      status: "executed",
      executedAt: new Date().toISOString(),
      sapPurchaseOrder: decision.sapPurchaseOrder
        ? { ...decision.sapPurchaseOrder, status: "confirmed" }
        : undefined,
    };
    return mockDelay({ ...mockDecisions[idx] });
  }
  return request<Recommendation>("/actions/execute", {
    method: "POST",
    body: JSON.stringify({ decisionId: id }),
  });
}

export function rejectDecision(id: string, reason: string): Promise<Recommendation> {
  if (USE_MOCK) {
    const idx = mockDecisions.findIndex((d) => d.id === id);
    if (idx === -1) return Promise.reject(new Error("Decision tidak ditemukan"));
    mockDecisions[idx] = {
      ...mockDecisions[idx],
      status: "rejected",
      verifierNote: reason,
    };
    return mockDelay({ ...mockDecisions[idx] });
  }
  return request<Recommendation>("/actions/reject", {
    method: "POST",
    body: JSON.stringify({ decisionId: id, reason }),
  });
}

export function getKpi(): Promise<KpiSnapshot> {
  if (USE_MOCK) {
    return mockDelay({ ...MOCK_KPI, previous: MOCK_KPI_PREVIOUS });
  }
  return request<KpiSnapshot>("/ui/kpi");
}

// ---------------------------------------------------------------------------
// Pemasok & Receiving Inspection (design.md §3.9c & §3.5b)
// ---------------------------------------------------------------------------

/** Skor kepercayaan pemasok terkini (Schema.md §1 `suppliers`). */
export function getSuppliers(): Promise<Supplier[]> {
  if (USE_MOCK) return mockDelay(MOCK_SUPPLIERS.map((s) => ({ ...s })));
  return request<Supplier[]>("/ui/suppliers");
}

/** Riwayat penerimaan + skor satu pemasok — dasar grafik "sebelum/sesudah insiden". */
export function getSupplierHistory(supplierId: string): Promise<SupplierHistory> {
  if (USE_MOCK) {
    const history = mockSupplierHistory(supplierId);
    if (!history) return Promise.reject(new Error("Pemasok tidak ditemukan"));
    return mockDelay(history);
  }
  return request<SupplierHistory>(`/suppliers/${supplierId}/history`);
}

const PHYSICAL_CONDITION_LABELS: Record<
  ReceivingInspectionRequest["physicalCondition"],
  string
> = {
  baik: "baik",
  rusak_sebagian: "rusak sebagian",
  rusak: "rusak",
};

/**
 * Receiving Inspection (design.md §3.5b): Ahli Gizi mencatat kondisi barang tiba.
 *
 * Menulis evidence `human_inspection` DAN mengisi `decisions.outcome`
 * (Schema.md §3). Kalau hasilnya `failure`, langkah LEARN (Skill.md §10) berjalan:
 * `reliability_score` pemasok kandidat terpilih diturunkan memakai formula yang
 * sama dengan UI. Status keputusan TIDAK diubah di sini — transisi status tetap
 * milik alur approvals (Schema.md §6).
 */
export function submitReceivingInspection(
  payload: ReceivingInspectionRequest,
): Promise<ReceivingInspectionResult> {
  if (USE_MOCK) {
    const idx = mockDecisions.findIndex((d) => d.id === payload.decisionId);
    if (idx === -1) return Promise.reject(new Error("Keputusan tidak ditemukan"));
    const decision = mockDecisions[idx];
    if (decision.status !== "approved" && decision.status !== "executed") {
      return Promise.reject(
        new Error(
          "Penerimaan hanya bisa dicatat untuk keputusan yang sudah disetujui atau dieksekusi",
        ),
      );
    }

    const outcome: DeliveryOutcome =
      payload.physicalCondition === "baik" ? "success" : "failure";
    const recordedAt = new Date().toISOString();
    const evidence: EvidenceItem = {
      id: `evi-${Math.floor(1000 + Math.random() * 8999)}`,
      type: "human_inspection",
      source: "Inspeksi petugas SPPG (Ahli Gizi)",
      summary: `Suhu terukur ${payload.measuredTempC} °C · kondisi ${
        PHYSICAL_CONDITION_LABELS[payload.physicalCondition]
      }${payload.note ? ` · ${payload.note}` : ""}`,
      recordedAt,
      isConsistent: outcome === "success",
    };

    mockDecisions[idx] = {
      ...decision,
      outcome,
      evidenceItems: [...(decision.evidenceItems ?? []), evidence],
    };

    // LEARN (Skill.md §10): hanya `failure` yang menurunkan skor. Ini yang membuat
    // perubahan skor TERLIHAT di layar, bukan cuma diklaim.
    if (outcome === "failure") {
      const winner = getWinningCandidate(decision);
      const supplierId = parseSupplierId(winner?.supplierId);
      if (supplierId) {
        const events =
          MOCK_SUPPLIER_EVENTS[supplierId] ??
          (MOCK_SUPPLIER_EVENTS[supplierId] = []);
        events.push({
          at: recordedAt,
          outcome,
          decisionId: decision.id,
          commodityId: decision.commodityId,
          quantityKg: decision.quantityKg,
          note: evidence.summary,
        });
        const supplier = MOCK_SUPPLIERS.find((s) => s.id === supplierId);
        if (supplier) {
          supplier.reliabilityScore = applyLearn(
            supplier.reliabilityScore,
            events.map((e) => e.outcome),
          );
        }
      }
    }

    return mockDelay({
      decision: { ...mockDecisions[idx] },
      evidenceId: evidence.id!,
      outcome,
      affectsSupplierReliability: outcome === "failure",
    });
  }

  return request<ReceivingInspectionResult>("/actions/receive", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
