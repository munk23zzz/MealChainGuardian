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
  Supplier,
  SupplierDetail,
} from "./api/schema";
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
} from "./mock-data";
import { buildMockSupplierDetail } from "./supplier-detail";

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
  return request<Recommendation>("/ui/actions/approve", {
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
  return request<Recommendation>("/ui/actions/execute", {
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
  return request<Recommendation>("/ui/actions/reject", {
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
// Pemasok (design.md §3.9c, Schema.md §1 `suppliers`)
// ---------------------------------------------------------------------------

/** Skor kepercayaan pemasok terkini (Schema.md §1 `suppliers`). */
export function getSuppliers(): Promise<Supplier[]> {
  if (USE_MOCK) return mockDelay(MOCK_SUPPLIERS.map((s) => ({ ...s })));
  return request<Supplier[]>("/ui/suppliers");
}

/**
 * Detail satu pemasok (`GET /ui/suppliers/{id}`) — batch, kuotasi, purchase order, riwayat eksklusi.
 *
 * Di mode mock isinya DITURUNKAN dari data yang sudah ada (`lib/supplier-detail.ts`), bukan tabel
 * baru: batch dari baris pasokan lokasi pemasok itu, kuotasi dari harga baris yang sama, PO dari
 * keputusan yang punya PO dengan sumber = lokasi pemasok. Panelnya ikut ditandai "Data Simulasi",
 * jadi tidak ada yang mengaku sebagai data nyata.
 */
export function getSupplier(id: string): Promise<SupplierDetail> {
  if (USE_MOCK) {
    const supplier = MOCK_SUPPLIERS.find((s) => s.id === id);
    if (!supplier) return Promise.reject(new Error("Pemasok tidak ditemukan"));
    return mockDelay(buildMockSupplierDetail(supplier, MOCK_SUPPLY, mockDecisions));
  }
  return request<SupplierDetail>(`/ui/suppliers/${id}`);
}

/** Panjang alasan eksklusi minimum — cerminan aturan backend (`app/core/supplier_exclusion.py`). */
const MIN_EXCLUSION_REASON = 10;

/**
 * Usulan eksklusi pemasok (Rules.md §1.2) — HANYA mencatat usulan, belum mengubah pemasok.
 *
 * Di backend ini memanggil `/ui/actions/propose-exclusion`, yang memakai jalur keputusan yang sama
 * dengan pembelian: keputusan berstatus `pending_approval`, dan approver yang sah adalah SPPG
 * pemasok itu. Di mock mode keputusan tiruan ditambahkan ke daftar yang sama supaya alur
 * approve → eksekusi bisa didemokan tanpa backend.
 */
export function proposeSupplierExclusion(
  supplierId: string,
  reason: string,
): Promise<Recommendation> {
  if (USE_MOCK) {
    const supplier = MOCK_SUPPLIERS.find((s) => s.id === supplierId);
    if (!supplier) return Promise.reject(new Error("Pemasok tidak ditemukan"));
    if (supplier.status === "excluded") {
      return Promise.reject(new Error(`${supplier.name} sudah dikecualikan.`));
    }
    if (reason.trim().length < MIN_EXCLUSION_REASON) {
      return Promise.reject(
        new Error(`Alasan eksklusi wajib diisi (minimal ${MIN_EXCLUSION_REASON} karakter).`),
      );
    }
    const alasan = reason.trim();
    const created: Recommendation = {
      id: `dec-exclusion-${mockDecisions.length + 1}`,
      decisionType: "supplier_exclusion",
      status: "pending_approval",
      sourceLocationId: supplier.locationId,
      targetLocationId: supplier.locationId,
      commodityId: "",
      quantityKg: 0,
      safeDeliveredCostBreakdown: [],
      // Usulan eksklusi belum punya bukti apa pun; ini nilai kosong yang jujur, bukan angka karangan.
      evidence: { sap: false, iot: false, physical: false, completenessPercent: 0, inconsistencies: [] },
      safetyCheck: "PASS",
      reason: `Usulan eksklusi ${supplier.name}: ${alasan}`,
      createdAt: new Date().toISOString(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      exclusionReason: alasan,
    };
    mockDecisions.unshift(created);
    return mockDelay({ ...created });
  }
  return request<Recommendation>("/ui/actions/propose-exclusion", {
    method: "POST",
    body: JSON.stringify({ supplierId, reason }),
  });
}

/**
 * Eksekusi eksklusi yang sudah di-approve — inilah titik `suppliers.status` berubah.
 *
 * Mock mode meniru aturan backend apa adanya: menolak sebelum `approved`, dan menolak keputusan
 * yang bukan eksklusi pemasok.
 */
export function excludeSupplier(id: string): Promise<Recommendation> {
  if (USE_MOCK) {
    const idx = mockDecisions.findIndex((d) => d.id === id);
    if (idx === -1) return Promise.reject(new Error("Decision tidak ditemukan"));
    const decision = mockDecisions[idx];
    if (decision.decisionType !== "supplier_exclusion") {
      return Promise.reject(new Error("Keputusan ini bukan usulan eksklusi pemasok."));
    }
    if (decision.status !== "approved") {
      return Promise.reject(
        new Error("Eksklusi hanya berlaku setelah disetujui SPPG pemasok (Rules.md §1.2)."),
      );
    }
    mockDecisions[idx] = {
      ...decision,
      status: "executed",
      executedAt: new Date().toISOString(),
    };
    const supplierIdx = MOCK_SUPPLIERS.findIndex((s) => s.id === decision.supplierId);
    if (supplierIdx !== -1) {
      MOCK_SUPPLIERS[supplierIdx] = {
        ...MOCK_SUPPLIERS[supplierIdx],
        status: "excluded",
        excludedAt: new Date().toISOString(),
        exclusionReason: decision.exclusionReason ?? decision.reason,
      };
    }
    return mockDelay({ ...mockDecisions[idx] });
  }
  return request<Recommendation>("/ui/actions/exclude", {
    method: "POST",
    body: JSON.stringify({ decisionId: id }),
  });
}
