import { Wrench } from "lucide-react";
import { formatDurationMs, formatTime } from "@/lib/format";
import type { AgentStep, AgentStepName } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

export const STEP_LABELS: Record<AgentStepName, string> = {
  DETECT: "Deteksi",
  VERIFY: "Verifikasi",
  TRACE: "Telusur",
  PREDICT: "Prediksi",
  OPTIMIZE: "Optimasi",
  DECIDE: "Keputusan",
  ACT: "Eksekusi",
  LEARN: "Belajar",
};

/** Urutan baku alur agent (design.md §3.4). */
export const AGENT_STEP_ORDER: AgentStepName[] = [
  "DETECT",
  "VERIFY",
  "TRACE",
  "PREDICT",
  "OPTIMIZE",
  "DECIDE",
  "ACT",
  "LEARN",
];

function orderIndex(step: AgentStepName): number {
  const idx = AGENT_STEP_ORDER.indexOf(step);
  return idx === -1 ? AGENT_STEP_ORDER.length : idx;
}

/**
 * AgentTraceViewer (design.md §3.4): timeline vertikal DETECT → … → LEARN dengan
 * tool yang dipanggil, input ringkas, output ringkas, waktu, dan durasi.
 *
 * Screen ini dipertunjukkan ke juri, jadi tidak ada data yang "dibulatkan":
 * durasi/input yang belum dilaporkan AgentCore Observability ditandai "-",
 * bukan diisi angka karangan.
 */
export function AgentTraceViewer({
  steps,
  className,
}: {
  steps: AgentStep[];
  className?: string;
}) {
  if (steps.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed border-navy-100 px-4 py-6 text-center text-muted-foreground",
          className,
        )}
      >
        Belum ada trace agent untuk keputusan ini. Trace muncul setelah agent
        berjalan dan AgentCore Observability mengirimkannya.
      </p>
    );
  }

  const ordered = [...steps].sort(
    (a, b) => orderIndex(a.step) - orderIndex(b.step),
  );

  return (
    <ol className={cn("flex flex-col", className)}>
      {ordered.map((step, index) => (
        <li
          key={`${step.step}-${index}`}
          className="flex gap-3 border-l border-border pb-4 pl-4 last:pb-0"
        >
          <span
            aria-hidden
            className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-navy-700"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-navy-700">
                {step.step}
              </span>
              <span className="font-medium text-navy-900">
                {STEP_LABELS[step.step]}
              </span>
              {step.tool && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-navy-900">
                  <Wrench className="h-3 w-3" />
                  {step.tool}
                </span>
              )}
              <span className="ml-auto tabular-nums text-muted-foreground">
                {formatTime(step.stepAt ?? step.timestamp)} ·{" "}
                {formatDurationMs(step.durationMs ?? Number.NaN)}
              </span>
            </div>

            {(step.inputSummary ?? step.input) && (
              <p className="mt-1 text-muted-foreground">
                <span className="font-medium text-navy-900">Input:</span>{" "}
                {step.inputSummary ?? step.input}
              </p>
            )}
            {(step.outputSummary ?? step.output) && (
              <p className="mt-0.5">
                <span className="font-medium text-navy-900">Output:</span>{" "}
                {step.outputSummary ?? step.output}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
