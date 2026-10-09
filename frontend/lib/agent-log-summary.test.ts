import { describe, it, expect } from "vitest";
import {
  parseToolSource,
  summarizeRun,
  durationShare,
  groupLogByDecision,
  maxDuration,
  type AgentLogEntry,
} from "./agent-log";

/**
 * design.md §3.4b (wajib terlihat, jangan disembunyikan): tiap step model AI
 * menampilkan chip sumber `primary`/`fallback_1`/`fallback_2`. Sumbernya adalah
 * suffix pada `agent_traces.tool_called` (Schema.md §6 + Architecture.md §10.4) —
 * BUKAN kolom baru, jadi helper ini yang menafsirkannya.
 */
describe("parseToolSource", () => {
  it("memisahkan suffix sumber model dari nama tool", () => {
    expect(parseToolSource("demand.forecast[fallback_1]")).toEqual({
      tool: "demand.forecast",
      modelSource: "fallback_1",
    });
  });

  it("mengenali primary dan fallback_2", () => {
    expect(parseToolSource("safety.evaluate[primary]").modelSource).toBe("primary");
    expect(parseToolSource("safety.evaluate[fallback_2]").modelSource).toBe(
      "fallback_2",
    );
  });

  it("tool non-model tidak diklaim memakai model (modelSource undefined)", () => {
    expect(parseToolSource("supply.get")).toEqual({
      tool: "supply.get",
      modelSource: undefined,
    });
  });

  it("suffix tak dikenal tidak ditebak — nama tool dibiarkan apa adanya", () => {
    expect(parseToolSource("supply.get[entah]")).toEqual({
      tool: "supply.get[entah]",
      modelSource: undefined,
    });
  });

  it("tool kosong/undefined aman", () => {
    expect(parseToolSource(undefined)).toEqual({
      tool: undefined,
      modelSource: undefined,
    });
    expect(parseToolSource("")).toEqual({ tool: "", modelSource: undefined });
  });
});

const entry = (over: Partial<AgentLogEntry>): AgentLogEntry => ({
  decisionId: "dec-1",
  sourceLocationId: "loc-1",
  targetLocationId: "loc-2",
  step: "DETECT",
  stepAt: "2026-10-07T02:00:00.000Z",
  ...over,
});

describe("summarizeRun", () => {
  const entries: AgentLogEntry[] = [
    entry({ step: "DETECT", tool: "supply.get", durationMs: 400 }),
    entry({ step: "PREDICT", tool: "demand.forecast[fallback_1]", durationMs: 1200 }),
    entry({ step: "OPTIMIZE", tool: "cost.safe_delivered[primary]", durationMs: 800 }),
    entry({ step: "ACT", tool: "actions.approve", durationMs: undefined }),
    entry({ decisionId: "dec-2", step: "DETECT", tool: "supply.get", durationMs: 100 }),
  ];

  it("menghitung step, keputusan, dan durasi yang benar-benar dilaporkan", () => {
    const s = summarizeRun(entries);
    expect(s.steps).toBe(5);
    expect(s.decisions).toBe(2);
    expect(s.reportedMs).toBe(2500);
  });

  it("tidak menyembunyikan step yang durasinya belum dilaporkan", () => {
    expect(summarizeRun(entries).unreportedDuration).toBe(1);
  });

  it("menunjuk step terlama sebagai bahan cerita ke juri", () => {
    const s = summarizeRun(entries);
    expect(s.slowest?.step).toBe("PREDICT");
    expect(s.slowest?.durationMs).toBe(1200);
  });

  it("hitung pemakaian provider cadangan (transparansi reliability)", () => {
    expect(summarizeRun(entries).fallbacks).toBe(1);
  });

  it("daftar kosong menghasilkan nol, bukan angka karangan", () => {
    const s = summarizeRun([]);
    expect(s).toEqual({
      steps: 0,
      decisions: 0,
      reportedMs: 0,
      unreportedDuration: 0,
      slowest: null,
      fallbacks: 0,
    });
  });
});

describe("durationShare", () => {
  it("proporsi durasi step terhadap total (untuk bar relatif)", () => {
    expect(durationShare(500, 2000)).toBeCloseTo(0.25);
  });

  it("durasi belum dilaporkan atau total nol → 0, bukan NaN", () => {
    expect(durationShare(undefined, 1000)).toBe(0);
    expect(durationShare(500, 0)).toBe(0);
  });

  it("tidak pernah melebihi 1", () => {
    expect(durationShare(5000, 1000)).toBe(1);
  });
});

describe("maxDuration", () => {
  it("mengembalikan durasi terbesar sebagai acuan bar relatif", () => {
    expect(
      maxDuration([{ durationMs: 100 }, { durationMs: 1240 }, { durationMs: 800 }]),
    ).toBe(1240);
  });

  it("mengabaikan durasi yang belum dilaporkan, nol saat tidak ada data", () => {
    expect(maxDuration([{}, { durationMs: undefined }])).toBe(0);
    expect(maxDuration([])).toBe(0);
  });
});

describe("groupLogByDecision", () => {
  it("mengelompokkan per keputusan, urut kemunculan pertama", () => {
    const groups = groupLogByDecision([
      entry({ decisionId: "dec-9" }),
      entry({ decisionId: "dec-1" }),
      entry({ decisionId: "dec-9" }),
    ]);
    expect(groups.map(([id]) => id)).toEqual(["dec-9", "dec-1"]);
    expect(groups[0][1]).toHaveLength(2);
  });
});
