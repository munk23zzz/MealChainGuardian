/**
 * Helpers murni (pure functions) untuk Agent Activity Log (design.md §3.4).
 *
 * Satu baris log = satu step agent dengan tool, input ringkas, output ringkas,
 * waktu, dan durasi — bentuknya mengikuti `agent_traces` di Schema.md §3.
 */
import type { AgentStep, Recommendation } from "./api/schema";

/**
 * Sumber model yang dipakai sebuah step. Datang dari suffix pada
 * `agent_traces.tool_called` — Schema.md §6: panggilan model AI WAJIB memakai
 * suffix `[primary]`/`[fallback_1]`/`[fallback_2]` supaya pemakaian provider
 * cadangan tidak pernah tersembunyi (dasar chip design.md §3.4b).
 */
export type ModelSource = "primary" | "fallback_1" | "fallback_2";

const MODEL_SOURCES: ModelSource[] = ["primary", "fallback_1", "fallback_2"];

export interface ParsedTool {
  /** Nama tool tanpa suffix sumber model. */
  tool?: string;
  /** undefined = tool ini bukan panggilan model AI (tidak ada suffix). */
  modelSource?: ModelSource;
}

/**
 * Pisahkan suffix sumber model dari nama tool.
 *
 * Suffix yang tidak dikenal TIDAK ditebak dan nama tool dibiarkan apa adanya —
 * lebih baik tampil janggal daripada mengklaim pemakaian model yang tidak ada.
 */
export function parseToolSource(tool?: string): ParsedTool {
  if (!tool) return { tool, modelSource: undefined };
  const match = /^(.*)\[(primary|fallback_1|fallback_2)\]$/.exec(tool);
  if (!match) return { tool, modelSource: undefined };
  const source = match[2] as ModelSource;
  return {
    tool: match[1],
    modelSource: MODEL_SOURCES.includes(source) ? source : undefined,
  };
}

/** Satu baris di timeline log — step agent yang dikaitkan ke keputusannya. */
export interface AgentLogEntry {
  decisionId: string;
  sourceLocationId: string;
  targetLocationId: string;
  step: AgentStep["step"];
  tool?: string;
  inputSummary?: string;
  outputSummary?: string;
  /** Durasi step (ms). undefined = belum dilaporkan AgentCore Observability. */
  durationMs?: number;
  /** Waktu step terjadi (ISO). */
  stepAt: string;
  /** Sumber model dari suffix tool; undefined = bukan panggilan model AI. */
  modelSource?: ModelSource;
}

/** Pecah agentTrace dari semua keputusan menjadi timeline datar. */
export function flattenTraces(
  recommendations: Recommendation[],
): AgentLogEntry[] {
  const entries: AgentLogEntry[] = [];
  for (const rec of recommendations) {
    if (!rec.agentTrace) continue;
    for (const step of rec.agentTrace) {
      entries.push({
        decisionId: rec.id,
        sourceLocationId: rec.sourceLocationId,
        targetLocationId: rec.targetLocationId,
        step: step.step,
        tool: step.tool,
        // Field lama (input/output/timestamp) tetap dibaca sebagai fallback
        // supaya data mock/versi awal tidak hilang saat skema berpindah.
        inputSummary: step.inputSummary ?? step.input,
        outputSummary: step.outputSummary ?? step.output,
        durationMs: step.durationMs,
        stepAt: step.stepAt ?? step.timestamp,
        modelSource: parseToolSource(step.tool).modelSource,
      });
    }
  }
  return entries;
}

export interface AgentLogFilter {
  decisionId?: string;
  /** Pencarian case-insensitive pada step/tool/input/output. */
  query?: string;
}

export function filterAgentLog(
  entries: AgentLogEntry[],
  filter: AgentLogFilter,
): AgentLogEntry[] {
  let result = entries;

  if (filter.decisionId) {
    result = result.filter((e) => e.decisionId === filter.decisionId);
  }

  const q = filter.query?.trim().toLowerCase();
  if (q) {
    result = result.filter((e) =>
      [e.step, e.tool, e.inputSummary, e.outputSummary]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }

  return result;
}

/** Log terbaru di atas (untuk tampilan timeline). */
export function sortLogNewestFirst(entries: AgentLogEntry[]): AgentLogEntry[] {
  return [...entries].sort(
    (a, b) => new Date(b.stepAt).getTime() - new Date(a.stepAt).getTime(),
  );
}

/**
 * Kelompokkan entry log per keputusan, urut sesuai kemunculan pertama
 * (dengan `sortLogNewestFirst` → keputusan terbaru di atas). Dipakai halaman
 * Agent Log supaya pengelompokan juga teruji, bukan logika di dalam komponen.
 */
export function groupLogByDecision(
  entries: AgentLogEntry[],
): [string, AgentLogEntry[]][] {
  const groups = new Map<string, AgentLogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.decisionId);
    if (list) list.push(entry);
    else groups.set(entry.decisionId, [entry]);
  }
  return Array.from(groups.entries());
}

/** Ringkasan satu run agent — header yang membuat trace terbaca sekilas. */
export interface RunSummary {
  steps: number;
  decisions: number;
  /** Total durasi step yang benar-benar dilaporkan AgentCore (ms). */
  reportedMs: number;
  /** Berapa step yang durasinya belum dilaporkan — tidak disembunyikan. */
  unreportedDuration: number;
  /** Step terlama; null kalau belum ada durasi yang dilaporkan. */
  slowest: { step: AgentStep["step"]; tool?: string; durationMs: number } | null;
  /** Berapa step memakai provider cadangan (fallback_1/fallback_2). */
  fallbacks: number;
}

export function summarizeRun(entries: AgentLogEntry[]): RunSummary {
  const decisions = new Set<string>();
  let reportedMs = 0;
  let unreportedDuration = 0;
  let fallbacks = 0;
  let slowest: RunSummary["slowest"] = null;

  for (const entry of entries) {
    decisions.add(entry.decisionId);

    // Sumber model dibaca dari suffix `tool` juga (bukan hanya field turunan):
    // data dari backend selalu membawa suffix di `tool_called` (Schema.md §6),
    // sementara `modelSource` hanya hasil parsing di frontend.
    const source = entry.modelSource ?? parseToolSource(entry.tool).modelSource;
    if (source && source !== "primary") {
      fallbacks += 1;
    }

    if (typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)) {
      reportedMs += entry.durationMs;
      if (!slowest || entry.durationMs > slowest.durationMs) {
        slowest = {
          step: entry.step,
          tool: entry.tool,
          durationMs: entry.durationMs,
        };
      }
    } else {
      unreportedDuration += 1;
    }
  }

  return {
    steps: entries.length,
    decisions: decisions.size,
    reportedMs,
    unreportedDuration,
    slowest,
    fallbacks,
  };
}

/**
 * Proporsi durasi satu step terhadap total (0..1) untuk bar relatif di timeline.
 * Durasi yang belum dilaporkan atau total nol → 0 (bukan NaN/Infinity, yang
 * membuat lebar bar jadi rusak).
 */
export function durationShare(
  durationMs: number | undefined,
  totalMs: number,
): number {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.min(1, durationMs / totalMs);
}

/**
 * Durasi terbesar di antara step/entry — acuan lebar bar relatif di timeline.
 *
 * Dipakai sebagai nilai default komponen: kalau caller tidak mengoper acuan,
 * bar tetap proporsional, bukan seragam nol (yang membuat semua bar sama-sama
 * tak terbaca).
 */
export function maxDuration(items: { durationMs?: number }[]): number {
  let max = 0;
  for (const item of items) {
    const value = item.durationMs;
    if (typeof value === "number" && Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max;
}
