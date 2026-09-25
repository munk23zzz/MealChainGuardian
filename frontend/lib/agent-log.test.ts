import { describe, it, expect } from "vitest";
import { flattenTraces, filterAgentLog } from "./agent-log";
import type { Recommendation } from "./api/schema";

const base: Recommendation = {
  id: "d1",
  status: "approved",
  decisionType: "regional_balance",
  sourceLocationId: "cianjur",
  targetLocationId: "jakarta",
  commodityId: "telur",
  quantityKg: 2000,
  safeDeliveredCostBreakdown: [],
  evidence: {
    sap: true,
    iot: true,
    physical: true,
    completenessPercent: 100,
    inconsistencies: [],
  },
  safetyCheck: "PASS",
  reason: "",
  createdAt: "2026-09-01T08:00:00Z",
  agentTrace: [
    {
      step: "DETECT",
      tool: "/supply",
      output: "Surplus Cianjur terdeteksi",
      timestamp: "2026-09-01T08:00:01Z",
    },
    {
      step: "DECIDE",
      tool: "/balance/recommend",
      output: "Kandidat Bogor terpilih",
      timestamp: "2026-09-01T08:00:05Z",
    },
  ],
};

describe("flattenTraces", () => {
  it("memecah trace tiap keputusan menjadi entry datar", () => {
    const entries = flattenTraces([base]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      decisionId: "d1",
      step: "DETECT",
      sourceLocationId: "cianjur",
      targetLocationId: "jakarta",
    });
  });

  it("mengabaikan keputusan tanpa agentTrace", () => {
    const noTrace = { ...base, id: "d2", agentTrace: undefined };
    expect(flattenTraces([noTrace])).toEqual([]);
  });
});

describe("filterAgentLog", () => {
  const entries = flattenTraces([base]);

  it("filter berdasarkan decisionId", () => {
    const result = filterAgentLog(entries, { decisionId: "d1" });
    expect(result).toHaveLength(2);
    const other = filterAgentLog(entries, { decisionId: "x" });
    expect(other).toHaveLength(0);
  });

  it("filter berdasarkan query teks (step/tool/output)", () => {
    expect(filterAgentLog(entries, { query: "bogor" })).toHaveLength(1);
    expect(filterAgentLog(entries, { query: "/supply" })).toHaveLength(1);
    expect(filterAgentLog(entries, { query: "DETECT" })).toHaveLength(1);
  });

  it("query kosong -> semua", () => {
    expect(filterAgentLog(entries, {})).toHaveLength(2);
  });
});
