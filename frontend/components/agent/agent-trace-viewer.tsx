import {
  Gavel,
  GraduationCap,
  Radar,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatDurationMs, formatTime } from "@/lib/format";
import type { AgentStep, AgentStepName } from "@/lib/api/schema";
import { durationShare, maxDuration, parseToolSource } from "@/lib/agent-log";
import { ModelSourceChip } from "@/components/agent/model-source-chip";
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

/** Ikon per tahap — membantu mata menemukan tahap saat menyusuri timeline. */
const STEP_ICONS: Record<AgentStepName, LucideIcon> = {
  DETECT: Radar,
  VERIFY: ShieldCheck,
  TRACE: Route,
  PREDICT: TrendingUp,
  OPTIMIZE: SlidersHorizontal,
  DECIDE: Gavel,
  ACT: Zap,
  LEARN: GraduationCap,
};

function orderIndex(step: AgentStepName): number {
  const idx = AGENT_STEP_ORDER.indexOf(step);
  return idx === -1 ? AGENT_STEP_ORDER.length : idx;
}

/**
 * AgentTraceViewer (design.md §3.4 & §3.4b): timeline vertikal DETECT → … → LEARN
 * dengan tool yang dipanggil, input ringkas, output ringkas, waktu, dan durasi.
 *
 * Screen ini dipertunjukkan ke juri, jadi:
 * - tiap step punya simpul berikon di atas rel yang menyambung (mudah disusuri);
 * - durasi divisualkan sebagai bar relatif terhadap tahap terlama, supaya
 *   kelihatan sekilas tahap mana yang paling mahal tanpa membaca angka;
 * - chip sumber model (`primary`/`fallback_N`) wajib tampil (§3.4b) — penggunaan
 *   provider cadangan tidak pernah disembunyikan;
 * - input/output panjang bisa dibuka-tutup: ringkas saat menyapu, lengkap saat
 *   juri bertanya. Durasi yang belum dilaporkan ditandai "-", bukan dikarang.
 */
export function AgentTraceViewer({
  steps,
  maxDurationMs = 0,
  className,
}: {
  steps: AgentStep[];
  /** Durasi tahap terlama di run ini — acuan lebar bar relatif. */
  maxDurationMs?: number;
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

  // Acuan bar durasi: pakai yang dioper caller, kalau tidak ada pakai tahap
  // terlama di run ini — supaya bar tetap proporsional (bukan seragam nol).
  const referenceMs = maxDurationMs > 0 ? maxDurationMs : maxDuration(ordered);

  return (
    <ol className={cn("flex flex-col", className)}>
      {ordered.map((step, index) => {
        const { tool, modelSource } = parseToolSource(step.tool);
        const Icon = STEP_ICONS[step.step];
        const durationMs = step.durationMs;
        const reported = typeof durationMs === "number";
        const share = durationShare(durationMs, referenceMs);
        const isSlowest =
          reported && referenceMs > 0 && durationMs === referenceMs;
        const isFallback = !!modelSource && modelSource !== "primary";
        const time = step.stepAt ?? step.timestamp;
        const input = step.inputSummary ?? step.input;
        const output = step.outputSummary ?? step.output;

        return (
          <li
            key={`${step.step}-${index}`}
            className="relative flex border-l border-navy-100 pb-5 pl-5 last:border-l-transparent last:pb-0"
          >
            {/* Simpul tahap — kuning bila step ini memakai provider cadangan */}
            <span
              aria-hidden
              className={cn(
                "absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border",
                isFallback
                  ? "border-status-warning bg-status-warning/20 text-navy-900"
                  : "border-navy-100 bg-card text-navy-700",
                isSlowest && !isFallback && "ring-2 ring-brand/25",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-xs font-semibold uppercase tracking-wide text-navy-700">
                  {step.step}
                </span>
                <span className="text-sm font-semibold text-navy-900">
                  {STEP_LABELS[step.step]}
                </span>
                {tool && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-navy-900">
                    <Wrench className="h-3 w-3" aria-hidden />
                    {tool}
                  </span>
                )}
                <ModelSourceChip source={modelSource} />
                {isSlowest && (
                  <span className="text-xs text-muted-foreground">
                    (tahap terlama)
                  </span>
                )}
                <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
                  {formatTime(time)} ·{" "}
                  <span
                    className={cn(
                      "font-medium",
                      reported ? "text-navy-900" : "text-muted-foreground",
                    )}
                  >
                    {reported ? formatDurationMs(durationMs) : "-"}
                  </span>
                </span>
              </div>

              {/* Bar durasi relatif terhadap tahap terlama */}
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-navy-100/70"
                role="img"
                aria-label={
                  reported
                    ? `Durasi ${formatDurationMs(durationMs)}, ${Math.round(
                        share * 100,
                      )}% dari tahap terlama`
                    : "Durasi belum dilaporkan AgentCore"
                }
              >
                {reported ? (
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isSlowest ? "bg-brand" : "bg-navy-700/60",
                    )}
                    style={{ width: `${Math.max(share * 100, 2)}%` }}
                  />
                ) : (
                  <div className="h-full w-full rounded-full border border-dashed border-navy-100" />
                )}
              </div>

              {input && (
                <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
                  <span className="font-medium text-navy-900">Input:</span>{" "}
                  {input}
                </p>
              )}
              {output && (
                <p className="mt-0.5 line-clamp-1 text-sm">
                  <span className="font-medium text-navy-900">Output:</span>{" "}
                  {output}
                </p>
              )}

              {(input || output) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-brand hover:underline">
                    Detail input &amp; output
                  </summary>
                  <dl className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2">
                    <dt className="text-xs font-medium text-navy-900">Input</dt>
                    <dd className="mb-2 whitespace-pre-wrap break-all font-mono text-xs text-navy-900">
                      {input ?? "-"}
                    </dd>
                    <dt className="text-xs font-medium text-navy-900">Output</dt>
                    <dd className="whitespace-pre-wrap break-all font-mono text-xs text-navy-900">
                      {output ?? "-"}
                    </dd>
                  </dl>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
