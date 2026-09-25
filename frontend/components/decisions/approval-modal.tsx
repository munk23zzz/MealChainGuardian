"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/status-badge";
import { buildApprovalSummary } from "@/lib/approval";
import type { Recommendation } from "@/lib/api/schema";

/**
 * ApprovalModal (design.md §3.5) — friksi yang disengaja.
 *
 * Sebelum approve, user WAJIB melihat: apa yang akan dieksekusi, ke SAP mana,
 * evidence utama, dan hasil audit Verifier. Tidak ada "approve all" massal.
 * Isi ringkasannya dibangun `lib/approval.ts` (teruji, tanpa DOM).
 */
export function ApprovalModal({
  recommendation,
  open,
  onOpenChange,
  onConfirm,
  submitting = false,
  error,
  locationLabel = (id) => id,
  commodityLabel = (id) => id,
}: {
  recommendation: Recommendation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  submitting?: boolean;
  error?: string | null;
  locationLabel?: (id: string) => string;
  commodityLabel?: (id: string) => string;
}) {
  const summary = buildApprovalSummary(recommendation, {
    locationLabel,
    commodityLabel,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Setujui dan eksekusi rekomendasi?</DialogTitle>
          <DialogDescription>
            Aksi ini menulis ke SAP (mock) dan hanya boleh satu per satu — tanpa
            approve massal.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <section className="rounded-lg border border-border p-3">
            <h4 className="font-semibold text-navy-900">Yang akan dieksekusi</h4>
            <p className="mt-1">{summary.what}.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge kind="decision" value={recommendation.status} />
              <StatusBadge kind="safety" value={recommendation.safetyCheck} />
            </div>
          </section>

          <section className="rounded-lg border border-border p-3">
            <h4 className="font-semibold text-navy-900">Ke SAP mana</h4>
            <p className="mt-1 text-muted-foreground">{summary.sapTarget}</p>
          </section>

          <section className="rounded-lg border border-border p-3">
            <h4 className="font-semibold text-navy-900">Evidence utama</h4>
            <p className="mt-1 text-muted-foreground">{summary.evidenceLine}.</p>
            {summary.constraintLine && (
              <p className="mt-1 text-muted-foreground">{summary.constraintLine}.</p>
            )}
          </section>

          <section className="rounded-lg border border-border p-3">
            <h4 className="font-semibold text-navy-900">Hasil audit Verifier</h4>
            <p className="mt-1 flex items-start gap-2">
              {summary.verifierIsFlag ? (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-safe" />
              )}
              <span className={summary.verifierIsFlag ? "" : "text-muted-foreground"}>
                {summary.verifierLine}
              </span>
            </p>
          </section>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-status-danger"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Batal
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? "Mengeksekusi..." : "Setujui & eksekusi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
