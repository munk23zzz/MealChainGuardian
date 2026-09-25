import { describe, it, expect } from "vitest";
import { flattenTraces, sortLogNewestFirst } from "./agent-log";
import type { Recommendation } from "./api/schema";

/**
 * design.md §3.4: tiap step menampilkan tool, input ringkas, output ringkas,
 * timestamp, dan durasi. Data lama (tanpa inputSummary/durationMs) tetap boleh
 * tampil, tapi jangan sampai field baru diabaikan.
 */
const rec: Recommendation = {
  id: "dec-1",
  status: "pending_approval",
  decisionType: "regional_balance",
  sourceLocationId: "loc-1",
  targetLocationId: "loc-2",
  commodityId: "com-telur",
  quantityKg: 200,
  safetyCheck: "PASS",
  reason: "test",
  createdAt: "2026-09-24T10:00:00.000Z",
  evidence: { sap: true, iot: true, physical: true, completenessPercent: 100, inconsistencies: [] },
  safeDeliveredCostBreakdown: [],
  agentTrace: [
    {
      step: "OPTIMIZE",
      tool: "cost.safe_delivered",
      inputSummary: "{ commodity: 'telur' }",
      outputSummary: "{ candidates: 3 }",
      durationMs: 820,
      stepAt: "2026-09-24T09:59:00.000Z",
      timestamp: "2026-09-24T09:59:00.000Z",
    },
    {
      step: "DETECT",
      tool: "supply.get",
      input: "{ location: 'loc-2' }",
      output: "defisit 220 kg",
      timestamp: "2026-09-24T09:58:00.000Z",
    },
  ],
};

describe("flattenTraces", () => {
  it("membawa ringkasan input/output, durasi, dan waktu step", () => {
    const entries = flattenTraces([rec]);
    const optimize = entries.find((e) => e.step === "OPTIMIZE");
    expect(optimize?.inputSummary).toBe("{ commodity: 'telur' }");
    expect(optimize?.outputSummary).toBe("{ candidates: 3 }");
    expect(optimize?.durationMs).toBe(820);
    expect(optimize?.stepAt).toBe("2026-09-24T09:59:00.000Z");
  });

  it("tetap membaca field lama (input/output/timestamp) sebagai fallback", () => {
    const entries = flattenTraces([rec]);
    const detect = entries.find((e) => e.step === "DETECT");
    expect(detect?.inputSummary).toBe("{ location: 'loc-2' }");
    expect(detect?.outputSummary).toBe("defisit 220 kg");
    expect(detect?.stepAt).toBe("2026-09-24T09:58:00.000Z");
    expect(detect?.durationMs).toBeUndefined();
  });

  it("mengaitkan tiap baris ke keputusan dan lokasinya", () => {
    const entries = flattenTraces([rec]);
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.decisionId).toBe("dec-1");
      expect(e.sourceLocationId).toBe("loc-1");
      expect(e.targetLocationId).toBe("loc-2");
    }
  });
});

describe("sortLogNewestFirst", () => {
  it("mengurutkan step terbaru di atas", () => {
    const entries = sortLogNewestFirst(flattenTraces([rec]));
    expect(entries.map((e) => e.step)).toEqual(["OPTIMIZE", "DETECT"]);
  });
});
