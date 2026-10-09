import { formatDurationMs } from "@/lib/format";
import { STEP_LABELS } from "@/components/agent/agent-trace-viewer";
import type { RunSummary } from "@/lib/agent-log";
import { cn } from "@/lib/utils";

/**
 * Ringkasan satu run agent (design.md §3.4 — screen paling penting untuk juri,
 * harus terbaca sekilas).
 *
 * Semua angka di sini berasal dari trace yang benar-benar dilaporkan AgentCore:
 * durasi yang belum dilaporkan TIDAK diisi angka karangan, tapi dihitung dan
 * ditampilkan jumlahnya supaya tidak ada data yang hilang diam-diam.
 */
export function RunSummaryStrip({
  summary,
  className,
}: {
  summary: RunSummary;
  className?: string;
}) {
  const items: { label: string; value: string; tone?: "warning" | "safe" }[] = [
    { label: "Step", value: String(summary.steps) },
    { label: "Keputusan", value: String(summary.decisions) },
    { label: "Durasi terlaporkan", value: formatDurationMs(summary.reportedMs) },
    {
      label: "Step terlama",
      value: summary.slowest
        ? `${STEP_LABELS[summary.slowest.step]} · ${formatDurationMs(
            summary.slowest.durationMs,
          )}`
        : "—",
    },
    {
      label: "Provider cadangan",
      value:
        summary.fallbacks > 0
          ? `${summary.fallbacks} step pakai fallback`
          : "tidak ada",
      tone: summary.fallbacks > 0 ? "warning" : "safe",
    },
  ];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {item.tone && (
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    item.tone === "warning"
                      ? "bg-status-warning"
                      : "bg-status-safe",
                  )}
                />
              )}
              <span className="truncate">{item.label}</span>
            </dt>
            <dd
              className="truncate font-medium tabular-nums text-navy-900"
              title={item.value}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {summary.unreportedDuration > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.unreportedDuration} step durasinya belum dilaporkan
          AgentCore Observability — ditampilkan &ldquo;-&rdquo;, bukan angka
          perkiraan.
        </p>
      )}
    </div>
  );
}
