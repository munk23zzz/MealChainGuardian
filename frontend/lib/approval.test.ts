import { describe, it, expect } from "vitest";
import { buildApprovalSummary } from "./approval";
import type { Recommendation } from "./api/schema";

/**
 * design.md §3.5: Approval Modal WAJIB menampilkan (1) apa yang akan dieksekusi,
 * (2) ke SAP mana, (3) evidence utama, (4) hasil audit Verifier.
 * Test ini menjaga keempatnya tidak pernah kosong.
 */
const base: Recommendation = {
  id: "dec-001",
  status: "pending_approval",
  decisionType: "regional_balance",
  sourceLocationId: "loc-1",
  targetLocationId: "loc-2",
  commodityId: "com-telur",
  quantityKg: 200,
  safetyCheck: "PASS",
  reason: "defisit telur",
  createdAt: "2026-09-24T10:00:00.000Z",
  evidence: {
    sap: true,
    iot: true,
    physical: true,
    completenessPercent: 95,
    inconsistencies: [],
  },
  safeDeliveredCostBreakdown: [
    {
      candidateId: "cand-1",
      supplierId: "loc-1",
      pricePerKg: 28000,
      transportCostPerKg: 1500,
      handlingCostPerKg: 500,
      spoilageRiskCostPerKg: 200,
      freshnessRiskCostPerKg: 100,
      safetyPenaltyPerKg: 0,
      totalSafeDeliveredCostPerKg: 30300,
      distanceKm: 12,
      etaMinutes: 45,
      evidenceCompleteness: 95,
    },
  ],
};

describe("buildApprovalSummary — data lengkap", () => {
  const rec: Recommendation = {
    ...base,
    evidenceItems: [
      {
        type: "sap_purchase_order",
        source: "SAP PO 4500001234",
        recordedAt: "2026-09-24T09:55:00.000Z",
        isConsistent: true,
      },
      {
        type: "temperature",
        source: "Sensor #12",
        recordedAt: "2026-09-24T09:56:00.000Z",
        isConsistent: false,
      },
      {
        type: "gps",
        source: "GPS truk",
        recordedAt: "2026-09-24T09:57:00.000Z",
        isConsistent: null,
      },
    ],
    constraints: [
      { name: "safety_eligibility", passed: true },
      { name: "freshness_threshold", passed: true },
      { name: "capacity", passed: true },
      { name: "delivery_window", passed: true },
    ],
    verifierNote: "Kandidat loc-3 dikeluarkan karena stok tidak lolos freshness.",
    verifiedBy: "verifier_agent",
  };
  const summary = buildApprovalSummary(rec, {
    locationLabel: (id) => (id === "loc-1" ? "SPPG Jakarta Pusat" : "SPPG Jakarta Utara"),
    commodityLabel: () => "Telur",
  });

  it("menjelaskan apa yang akan dieksekusi", () => {
    expect(summary.what).toBe(
      "Kirim 200 kg Telur dari SPPG Jakarta Pusat ke SPPG Jakarta Utara",
    );
  });

  it("menyebut SAP sebagai tujuan eksekusi dan menandainya mock", () => {
    expect(summary.sapTarget).toContain("SAP");
    expect(summary.sapTarget).toContain("mock SAP");
    expect(summary.sapTarget).toContain("Rp 30.300/kg");
  });

  it("menyebut plant tujuan dengan NAMA lokasi, bukan id mentah", () => {
    expect(summary.sapTarget).toContain("SPPG Jakarta Utara");
    expect(summary.sapTarget).not.toContain("plant loc-2");
  });

  it("meringkas evidence utama termasuk bukti yang tidak konsisten", () => {
    expect(summary.evidenceLine).toContain("95%");
    expect(summary.evidenceLine).toContain("1 bukti konsisten");
    expect(summary.evidenceLine).toContain("1 tidak konsisten");
    expect(summary.evidenceLine).toContain("1 belum diuji");
  });

  it("meringkas hard constraint", () => {
    expect(summary.constraintLine).toBe("Hard constraint: 4/4 lolos");
  });

  it("menampilkan catatan Verifier beserta identitasnya sebagai flag", () => {
    expect(summary.verifierIsFlag).toBe(true);
    expect(summary.verifierLine).toContain("loc-3");
    expect(summary.verifierLine).toContain("verifier_agent");
  });
});

describe("buildApprovalSummary — data minimal (tanpa evidenceItems/constraints)", () => {
  const summary = buildApprovalSummary(base);

  it("tetap memberi ringkasan evidence dari flag lama", () => {
    expect(summary.evidenceLine).toContain("95%");
    expect(summary.evidenceLine).toContain("SAP, IoT, inspeksi fisik");
  });

  it("menyebut jumlah inkonsistensi kalau ada", () => {
    const withInconsistency = buildApprovalSummary({
      ...base,
      evidence: {
        ...base.evidence,
        inconsistencies: [{ description: "suhu rantai dingin terputus" }],
      },
    });
    expect(withInconsistency.evidenceLine).toContain("1 inkonsistensi");
  });

  it("tidak menyatakan constraint aman kalau datanya belum ada", () => {
    expect(summary.constraintLine).toBeNull();
  });

  it("menyatakan eksplisit kalau Verifier tidak memberi flag", () => {
    expect(summary.verifierIsFlag).toBe(false);
    expect(summary.verifierLine).toBe("Tidak ada flag dari Verifier Agent.");
  });
});
