"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Factory, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApprovalModal } from "@/components/decisions/approval-modal";
import { StatusBadge } from "@/components/status/status-badge";
import { useAuth } from "@/contexts/auth";
import { approveDecision, executeDecision, rejectDecision } from "@/lib/api";
import { canApproveForLocation } from "@/lib/auth";
import type { Recommendation } from "@/lib/api/schema";

/**
 * Aksi approval (design.md §3.5).
 *
 * Aturan yang dipegang:
 * - Approve TIDAK pernah satu klik: selalu lewat ApprovalModal dengan ringkasan
 *   apa yang dieksekusi, ke SAP mana, evidence, dan audit Verifier.
 * - Tidak ada approve massal.
 * - Eksekusi ke SAP hanya untuk keputusan yang sudah di-approve (Rules.md §1.2).
 */
export function ApprovalActions({
  recommendation,
  locationLabel = (id) => id,
  commodityLabel = (id) => id,
}: {
  recommendation: Recommendation;
  locationLabel?: (id: string) => string;
  commodityLabel?: (id: string) => string;
}) {
  const queryClient = useQueryClient();
  const { payload } = useAuth();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["decisions"] });
  };

  const approveMutation = useMutation({
    mutationFn: () => approveDecision(recommendation.id),
    onSuccess: () => {
      setApproveOpen(false);
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Gagal menyetujui");
    },
  });

  const executeMutation = useMutation({
    mutationFn: () => executeDecision(recommendation.id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Gagal mengeksekusi");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectDecision(recommendation.id, reason.trim()),
    onSuccess: () => {
      setRejectOpen(false);
      setReason("");
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Gagal menolak");
    },
  });

  const canApprove =
    recommendation.status === "pending_approval" ||
    recommendation.status === "verifier_flagged";
  const canExecute = recommendation.status === "approved";
  const permitted = canApproveForLocation(payload, recommendation.targetLocationId);

  if (!canApprove && !canExecute) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
        <span className="font-medium text-navy-900">Status keputusan:</span>
        <StatusBadge kind="decision" value={recommendation.status} />
        {recommendation.sapPurchaseOrder && (
          <span className="text-muted-foreground">
            SAP PO {recommendation.sapPurchaseOrder.poNumber} (
            {recommendation.sapPurchaseOrder.status})
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-navy-900">Keputusan Anda</h2>

      {canApprove && !permitted && (
        <p className="text-muted-foreground">
          Anda tidak punya hak approval untuk lokasi tujuan ini (
          {locationLabel(recommendation.targetLocationId)}). Hubungi admin
          Dinas/BGN.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-status-danger"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canApprove && permitted && (
          <>
            <Button onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              Setujui…
            </Button>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(true)}
              className="border-status-danger/40 text-status-danger hover:bg-status-danger/10 hover:text-status-danger"
            >
              <XCircle className="h-4 w-4" />
              Tolak
            </Button>
          </>
        )}

        {canExecute && (
          <Button
            onClick={() => executeMutation.mutate()}
            disabled={executeMutation.isPending}
          >
            <Factory className="h-4 w-4" />
            {executeMutation.isPending
              ? "Mengeksekusi…"
              : "Eksekusi ke SAP (mock)"}
          </Button>
        )}
      </div>

      <p className="text-muted-foreground">
        Approve diproses satu per satu (tanpa aksi massal) dan selalu menampilkan
        ringkasan evidence lebih dulu.
      </p>

      <ApprovalModal
        recommendation={recommendation}
        open={approveOpen}
        onOpenChange={setApproveOpen}
        onConfirm={() => approveMutation.mutate()}
        submitting={approveMutation.isPending}
        error={error}
        locationLabel={locationLabel}
        commodityLabel={commodityLabel}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Tolak rekomendasi ini?</DialogTitle>
            <DialogDescription>
              Alasan penolakan wajib diisi — dipakai sebagai catatan audit
              keputusan.
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-navy-900">Alasan penolakan</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: stok pengganti belum terverifikasi petugas"
              className="min-h-24 rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>

          {error && (
            <p role="alert" className="text-status-danger">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || reason.trim().length === 0}
            >
              {rejectMutation.isPending ? "Memproses…" : "Tolak rekomendasi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
