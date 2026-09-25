import { describe, it, expect } from "vitest";
import {
  EVIDENCE_TYPE_LABELS,
  evidenceTone,
  summarizeEvidenceConsistency,
} from "./evidence";
import type { EvidenceItem } from "./api/schema";

const item = (over: Partial<EvidenceItem>): EvidenceItem => ({
  type: "temperature",
  source: "Sensor IoT #12",
  recordedAt: "2026-09-24T10:00:00.000Z",
  isConsistent: true,
  ...over,
});

describe("EVIDENCE_TYPE_LABELS", () => {
  it("mencakup semua jenis bukti di Schema.md §3", () => {
    expect(Object.keys(EVIDENCE_TYPE_LABELS).sort()).toEqual([
      "gps",
      "human_inspection",
      "market_price",
      "sap_goods_receipt",
      "sap_purchase_order",
      "temperature",
    ]);
  });

  it("label menjelaskan sumber, bukan istilah kode mentah", () => {
    expect(EVIDENCE_TYPE_LABELS.sap_purchase_order).toContain("SAP");
    expect(EVIDENCE_TYPE_LABELS.human_inspection).toContain("Inspeksi");
  });
});

describe("evidenceTone", () => {
  it("konsisten = aman, tidak konsisten = bahaya, belum diperiksa = netral", () => {
    expect(evidenceTone(true)).toBe("safe");
    expect(evidenceTone(false)).toBe("danger");
    expect(evidenceTone(null)).toBe("neutral");
  });
});

describe("summarizeEvidenceConsistency", () => {
  it("menghitung bukti konsisten/tidak/ belum diperiksa", () => {
    const summary = summarizeEvidenceConsistency([
      item({ isConsistent: true }),
      item({ isConsistent: false }),
      item({ isConsistent: null }),
      item({ isConsistent: true }),
    ]);
    expect(summary).toEqual({ consistent: 2, inconsistent: 1, unknown: 1 });
  });

  it("daftar kosong tetap mengembalikan angka 0, bukan undefined", () => {
    expect(summarizeEvidenceConsistency([])).toEqual({
      consistent: 0,
      inconsistent: 0,
      unknown: 0,
    });
  });
});
