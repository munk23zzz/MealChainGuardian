"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { AgentTraceViewer, STEP_LABELS } from "@/components/agent/agent-trace-viewer";
import { StatusBadge } from "@/components/status/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useDecisions, useLocations } from "@/hooks/use-data";
import { flattenTraces, filterAgentLog, sortLogNewestFirst } from "@/lib/agent-log";
import type { AgentLogEntry } from "@/lib/agent-log";
import { locationLabel } from "@/lib/labels";
import { formatDateTime, formatDurationMs } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Agent Activity Log (design.md §3.4) — screen paling penting untuk demo juri.
 *
 * Timeline vertikal DETECT → LEARN: tool yang dipanggil, input ringkas, output
 * ringkas, waktu, dan durasi. Data diambil dari trace agent (AgentCore
 * Observability), bukan log buatan frontend.
 *
 * Polling 8 detik (`useDecisions({ demo: true })`) dialah pengganti WebSocket
 * untuk demo (design.md §5).
 */
export default function AgentLogPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <AgentLogPageInner />
    </Suspense>
  );
}

function AgentLogPageInner() {
  const searchParams = useSearchParams();
  const initialDecision = searchParams.get("decision") ?? "all";

  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } =
    useDecisions({ demo: true });
  const locationsQuery = useLocations();
  const [decisionFilter, setDecisionFilter] = useState<string>(initialDecision);
  const [query, setQuery] = useState("");

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const decisions = useMemo(() => data ?? [], [data]);

  const entries: AgentLogEntry[] = useMemo(
    () => sortLogNewestFirst(flattenTraces(decisions)),
    [decisions],
  );

  const visible = useMemo(
    () =>
      filterAgentLog(entries, {
        decisionId: decisionFilter === "all" ? undefined : decisionFilter,
        query,
      }),
    [entries, decisionFilter, query],
  );

  const stepCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of visible) {
      counts.set(e.step, (counts.get(e.step) ?? 0) + 1);
    }
    return counts;
  }, [visible]);

  const totalDuration = visible.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
  const label = (id: string) => locationLabel(id, locations);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">
            Agent Activity Log
          </h1>
          <p className="text-muted-foreground">
            Trace asli dari AgentCore Observability — DETECT → VERIFY → TRACE →
            PREDICT → OPTIMIZE → DECIDE → ACT → LEARN.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            {isFetching ? "memperbarui…" : "terbaru"}{" "}
            {dataUpdatedAt ? formatDateTime(new Date(dataUpdatedAt).toISOString()) : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Muat ulang
          </Button>
        </div>
      </div>

      {error && (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}

      {/* Filter per decision_id + pencarian (design.md §3.4) */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground">Keputusan:</span>
            <select
              value={decisionFilter}
              onChange={(e) => setDecisionFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="all">Semua keputusan</option>
              {decisions.map((d) => (
                <option key={d.id} value={d.id}>
                  #{d.id} · {label(d.sourceLocationId)} → {label(d.targetLocationId)}
                </option>
              ))}
            </select>
          </label>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari step / tool / input / output…"
            className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />

          <span className="text-muted-foreground">
            {visible.length} step · total durasi terlaporkan{" "}
            {formatDurationMs(totalDuration)}
          </span>
        </CardContent>
      </Card>

      {visible.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(STEP_LABELS).map(([step, stepLabel]) => (
            <span
              key={step}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                stepCounts.get(step)
                  ? "border-navy-700/30 bg-navy-700/10 text-navy-700"
                  : "border-border text-muted-foreground",
              )}
            >
              {stepLabel} · {stepCounts.get(step) ?? 0}
            </span>
          ))}
        </div>
      )}

      {isPending ? (
        <SkeletonRows rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          title="Belum ada aktivitas agent yang cocok"
          description="Trace muncul setelah agent berjalan dan AgentCore Observability mengirimkannya. Coba ganti filter keputusan atau kosongkan pencarian."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {groupByDecision(visible).map(([decisionId, steps]) => (
            <Card key={decisionId}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/decisions/${decisionId}`}
                    className="hover:underline"
                  >
                    #{decisionId}
                  </Link>
                  <span className="font-normal text-muted-foreground">
                    {label(steps[0].sourceLocationId)} →{" "}
                    {label(steps[0].targetLocationId)}
                  </span>
                  {(() => {
                    const decision = decisions.find((d) => d.id === decisionId);
                    return decision ? (
                      <StatusBadge kind="decision" value={decision.status} />
                    ) : null;
                  })()}
                </CardTitle>
                <Link
                  href={`/decisions/${decisionId}`}
                  className="text-navy-700 hover:underline"
                >
                  Lihat keputusan
                </Link>
              </CardHeader>
              <CardContent className="pt-3">
                <AgentTraceViewer
                  steps={steps.map((s) => ({
                    step: s.step,
                    tool: s.tool,
                    inputSummary: s.inputSummary,
                    outputSummary: s.outputSummary,
                    durationMs: s.durationMs,
                    stepAt: s.stepAt,
                    timestamp: s.stepAt,
                  }))}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kelompokkan entry log per keputusan, urut sesuai kemunculan (terbaru dulu). */
function groupByDecision(entries: AgentLogEntry[]): [string, AgentLogEntry[]][] {
  const groups = new Map<string, AgentLogEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.decisionId);
    if (list) list.push(entry);
    else groups.set(entry.decisionId, [entry]);
  }
  return Array.from(groups.entries());
}
