"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge, ToneBadge } from "@/components/status/status-badge";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { SafeDeliveredCostBreakdown } from "@/components/decisions/safe-delivered-cost-breakdown";
import { ConstraintChecklist } from "@/components/decisions/constraint-checklist";
import { ApprovalActions } from "@/components/decisions/approval-actions";
import { EvidenceTimeline } from "@/components/evidence/evidence-timeline";
import { AgentTraceViewer } from "@/components/agent/agent-trace-viewer";
import {
  useCommodities,
  useDecision,
  useLocations,
} from "@/hooks/use-data";
import { getWinningCandidate } from "@/lib/decisions";
import { commodityLabel, locationLabel } from "@/lib/labels";
import { DECISION_TYPE_LABELS } from "@/lib/labels";
import { urgencyLabel, urgencyTier } from "@/lib/urgency";
import { formatDateTime, formatKg, formatRupiah } from "@/lib/format";

/**
 * Decision Detail & Evidence (design.md §3.3).
 *
 * Prinsip design.md §1.1: tidak ada angka tanpa jejak — tiap klaim di halaman ini
 * punya sumber (SAP/IoT/inspeksi) atau ditandai "belum dilaporkan".
 */
export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: decision, error, isPending, refetch, isFetching } = useDecision(
    params.id,
    { demo: true },
  );
  const locationsQuery = useLocations();
  const commoditiesQuery = useCommodities();

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const commodities = useMemo(
    () => commoditiesQuery.data ?? [],
    [commoditiesQuery.data],
  );

  if (error) {
    return (
      <ErrorState
        message={(error as Error).message}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }

  if (isPending || !decision) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonRows rows={2} />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  const winner = getWinningCandidate(decision);
  const label = (id: string) => locationLabel(id, locations);
  const comLabel = (id: string) => commodityLabel(id, commodities);
  const tier = urgencyTier(decision);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/decisions" className="text-navy-700 hover:underline">
          ← Kembali ke feed
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-navy-900">
            {label(decision.sourceLocationId)}{" "}
            <ArrowRight className="inline h-4 w-4" />{" "}
            {label(decision.targetLocationId)}
          </h1>
          <StatusBadge kind="decision" value={decision.status} />
          <StatusBadge kind="safety" value={decision.safetyCheck} />
          <ToneBadge tone={tier === 0 ? "danger" : tier === 1 ? "warning" : "info"}>
            {urgencyLabel(decision)}
          </ToneBadge>
        </div>
        <p className="mt-1 text-muted-foreground">
          {DECISION_TYPE_LABELS[decision.decisionType]} · {comLabel(decision.commodityId)}{" "}
          · {formatKg(decision.quantityKg)} · dibuat{" "}
          {formatDateTime(decision.createdAt)}
        </p>
      </div>

      {decision.reason && (
        <Card>
          <CardHeader>
            <CardTitle>Alasan rekomendasi</CardTitle>
          </CardHeader>
          <CardContent className="pt-1">{decision.reason}</CardContent>
        </Card>
      )}

      <SafeDeliveredCostBreakdown
        candidates={decision.safeDeliveredCostBreakdown}
        winnerId={winner?.candidateId}
        title={
          winner
            ? `Safe Delivered Cost — kandidat terpilih ${formatRupiah(
                winner.totalSafeDeliveredCostPerKg,
              )}/kg`
            : "Safe Delivered Cost"
        }
      />

      <ConstraintChecklist constraints={decision.constraints} />

      {/* Evidence (design.md §3.3) */}
      <Card>
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
          <CardDescription>
            Kelengkapan bukti {decision.evidence.completenessPercent}% — setiap
            bukti menyertakan sumber dan waktu pencatatannya.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-1">
          {decision.evidenceItems && decision.evidenceItems.length > 0 ? (
            <EvidenceTimeline items={decision.evidenceItems} />
          ) : (
            <div className="flex flex-wrap gap-4">
              <span>Data SAP {decision.evidence.sap ? "tersedia" : "tidak tersedia"}</span>
              <span>Sensor IoT {decision.evidence.iot ? "tersedia" : "tidak tersedia"}</span>
              <span>
                Inspeksi fisik {decision.evidence.physical ? "tersedia" : "tidak tersedia"}
              </span>
            </div>
          )}

          {decision.evidence.inconsistencies.length > 0 && (
            <ul className="flex flex-col gap-1">
              {decision.evidence.inconsistencies.map((inc, i) => (
                <li key={i} className="flex items-start gap-2 text-status-danger">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {inc.description}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Catatan audit Verifier Agent (design.md §3.3) */}
      <Card>
        <CardHeader>
          <CardTitle>Catatan audit Verifier Agent</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-2 pt-1">
          {decision.verifierNote ? (
            <>
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
              <span>
                {decision.verifierNote}
                {decision.verifiedBy && (
                  <span className="ml-1 text-muted-foreground">
                    ({decision.verifiedBy})
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-safe" />
              <span className="text-muted-foreground">
                Verifier tidak menemukan ketidaksesuaian
                {decision.verifiedBy ? ` (diperiksa oleh ${decision.verifiedBy})` : ""}.
              </span>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trace agent — sumber: AgentCore Observability (design.md §3.4) */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Trace agent</CardTitle>
            <CardDescription>
              DETECT → LEARN, dengan tool, input, output, dan durasinya.
            </CardDescription>
          </div>
          <Link
            href={`/agent-log?decision=${decision.id}`}
            className="text-navy-700 hover:underline"
          >
            Buka Agent Activity Log
          </Link>
        </CardHeader>
        <CardContent className="pt-3">
          <AgentTraceViewer steps={decision.agentTrace ?? []} />
        </CardContent>
      </Card>

      {/* Bukti eksekusi ke SAP (mock) */}
      {decision.sapPurchaseOrder && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase order SAP (mock)</CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            PO {decision.sapPurchaseOrder.poNumber} · plant{" "}
            {label(decision.sapPurchaseOrder.plant)} ·{" "}
            {formatKg(decision.sapPurchaseOrder.orderedQuantityKg)} · status{" "}
            {decision.sapPurchaseOrder.status}
            <span className="mt-1 block text-muted-foreground">
              Nomor PO ini berasal dari mock SAP (data simulasi), bukan SAP
              produksi.
            </span>
          </CardContent>
        </Card>
      )}

      <ApprovalActions
        recommendation={decision}
        locationLabel={label}
        commodityLabel={comLabel}
      />
    </div>
  );
}
