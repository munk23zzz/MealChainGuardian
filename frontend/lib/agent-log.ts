/**
 * Helpers murni (pure functions) untuk Agent Activity Log (design.md §3.4).
 *
 * Satu baris log = satu step agent dengan tool, input ringkas, output ringkas,
 * waktu, dan durasi — bentuknya mengikuti `agent_traces` di Schema.md §3.
 */
import type { AgentStep, Recommendation } from "./api/schema";

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
