"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AgentTraceViewer, STEP_LABELS } from "@/components/agent/agent-trace-viewer";
import { RunSummaryStrip } from "@/components/agent/run-summary";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useDecisions, useLocations } from "@/hooks/use-data";
import { useAuth } from "@/contexts/auth";
import { scopeForRole } from "@/lib/role";
import {
  decisionTouchesScope,
  partitionByScope,
  scopeDescription,
} from "@/lib/scope";
import {
  filterAgentLog,
  flattenTraces,
  groupLogByDecision,
  sortLogNewestFirst,
  summarizeRun,
} from "@/lib/agent-log";
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

  /**
   * Cakupan peran (design.md §1.4): trace agent memuat rencana pengiriman antar
   * SPPG, jadi run di luar cakupan tidak ditampilkan — termasuk dari dropdown
   * filter, supaya tidak ada jalan pintas untuk melihatnya.
   */
  const { role, region, locationId } = useAuth();
  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const { inScope: scopedDecisions, outOfScope: outsideDecisions } = useMemo(
    () =>
      partitionByScope(decisions, (d) =>
        decisionTouchesScope(d, roleScope, locations),
      ),
    [decisions, roleScope, locations],
  );

  const entries: AgentLogEntry[] = useMemo(
    () => sortLogNewestFirst(flattenTraces(scopedDecisions)),
    [scopedDecisions],
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

  /** Ringkasan seluruh run yang sedang terlihat (header yang terbaca sekilas). */
  const summary = useMemo(() => summarizeRun(visible), [visible]);

  /** Kelompok per keputusan + ringkasan masing-masing (tidak dihitung di render). */
  const groups = useMemo(
    () =>
      groupLogByDecision(visible).map(([decisionId, steps]) => ({
        decisionId,
        steps,
        run: summarizeRun(steps),
      })),
    [visible],
  );

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
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden
              className={cn(
                "inline-block h-2 w-2 rounded-full",
                isFetching ? "bg-status-warning" : "bg-status-safe",
              )}
            />
            {isFetching ? "memperbarui…" : "terbaru"}{" "}
            {dataUpdatedAt ? formatDateTime(new Date(dataUpdatedAt).toISOString()) : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Muat ulang
          </Button>
        </div>
      </div>

      {outsideDecisions.length > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-navy-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>
            {scopeDescription(roleScope, outsideDecisions.length, locations)} — trace
            keputusan di luar cakupan tidak ditampilkan.
          </span>
        </p>
      )}

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
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
            <span className="shrink-0 font-medium text-muted-foreground">Keputusan:</span>
            <select
              value={decisionFilter}
              onChange={(e) => setDecisionFilter(e.target.value)}
              className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-auto"
            >
              <option value="all">Semua keputusan</option>
              {scopedDecisions.map((d) => (
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
            className="h-11 w-full max-w-sm rounded-md border border-input bg-background px-3 outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9"
          />

        </CardContent>
      </Card>

      {/* Ringkasan run — dibaca sekilas sebelum menyusuri timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ringkasan run</CardTitle>
        </CardHeader>
        <CardContent>
          <RunSummaryStrip summary={summary} />
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
          {groups.map(({ decisionId, steps, run }) => (
            <Card key={decisionId}>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/decisions/${decisionId}`}
                    className="inline-flex min-h-11 items-center hover:underline sm:min-h-0"
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
                  className="inline-flex min-h-11 items-center text-brand hover:underline sm:min-h-0"
                >
                  Lihat keputusan
                </Link>
              </CardHeader>
              <CardContent className="pt-3">
                <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">{run.steps} step</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {formatDurationMs(run.reportedMs)} terlaporkan
                  </span>
                  {run.slowest && (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        tahap terlama {STEP_LABELS[run.slowest.step]}{" "}
                        <span className="tabular-nums">
                          {formatDurationMs(run.slowest.durationMs)}
                        </span>
                      </span>
                    </>
                  )}
                  {run.fallbacks > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <Badge tone="warning">
                        {run.fallbacks} step pakai provider cadangan
                      </Badge>
                    </>
                  )}
                </p>
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
                  maxDurationMs={run.slowest?.durationMs ?? 0}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
