"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Factory, ShieldAlert, XCircle } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/auth";
import { useToast } from "@/components/ui/toast";
import { approveDecision, excludeSupplier, executeDecision, rejectDecision } from "@/lib/api";
import { approvalDenialReason, canApproveForLocation } from "@/lib/auth";
import { expiryState } from "@/lib/expiry";
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
  const { payload, canApprove: userCanApprove } = useAuth();
  const { push } = useToast();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["decisions"] });
  };

  // Usulan eksklusi pemasok dieksekusi lewat aksi lain daripada pembelian: yang berubah
  // `suppliers.status`, bukan purchase order (Rules.md §1.2).
  const isExclusion = recommendation.decisionType === "supplier_exclusion";

  const approveMutation = useMutation({
    mutationFn: () => approveDecision(recommendation.id),
    onSuccess: () => {
      setApproveOpen(false);
      setError(null);
      invalidate();
      // Jejak aksi: approval selalu memberi konfirmasi yang bisa dibaca ulang.
      push({
        title: "Approval tercatat",
        description: `${recommendation.id} disetujui. Bila butuh dua approval, status berlanjut ke approver kedua.`,
        tone: "success",
      });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Gagal menyetujui");
    },
  });

  const executeMutation = useMutation({
    // Eksklusi pemasok dieksekusi lewat pintu sendiri (`/ui/actions/exclude`), bukan lewat SAP:
    // yang berubah adalah `suppliers.status`, bukan purchase order.
    mutationFn: () =>
      isExclusion ? excludeSupplier(recommendation.id) : executeDecision(recommendation.id),
    onSuccess: () => {
      setError(null);
      invalidate();
      if (isExclusion) {
        push({
          title: "Eksklusi pemasok berlaku",
          description: `${
            recommendation.supplierName ?? "Pemasok"
          } tidak lagi dipilih untuk purchase order berikutnya.`,
          tone: "success",
        });
        return;
      }
      push({
        title: "Diteruskan ke SAP (mock)",
        description: recommendation.sapPurchaseOrder
          ? `Purchase order ${recommendation.sapPurchaseOrder.poNumber} tercatat.`
          : "Eksekusi tercatat di jejak audit.",
        tone: "success",
      });
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
      push({
        title: "Rekomendasi ditolak",
        description: "Alasan tersimpan sebagai catatan audit.",
        tone: "warning",
      });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Gagal menolak");
    },
  });

  // Schema.md §3: `verifier_flagged` butuh 2 approval (Kepala + Ahli Gizi dari SPPG
  // yang sama); `pending_approval` cukup 1.
  const canApprove =
    recommendation.status === "pending_approval" ||
    recommendation.status === "verifier_flagged";
  const canExecute = recommendation.status === "approved";
  const permitted =
    userCanApprove &&
    canApproveForLocation(payload, recommendation.targetLocationId);

  /**
   * Alasan penolakan untuk kalimat penjelasan; dihitung lewat lokasi semu agar memakai
   * aturan yang SAMA dengan otorisasi — tidak ada dua definisi cakupan yang bisa
   * berbeda diam-diam.
   */
  const denialReason = approvalDenialReason(payload, recommendation, [
    { id: recommendation.targetLocationId },
  ]);

  if (!canApprove && !canExecute) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
        <span className="font-medium text-navy-900">Status keputusan:</span>
        <StatusBadge kind="decision" value={recommendation.status} />
        {expiryState(recommendation.expiresAt) === "expired" && (
          <span className="text-muted-foreground">
            Lewat batas waktu
            {recommendation.expiresAt
              ? ` (${formatDateTime(recommendation.expiresAt)})`
              : ""}{" "}
            — keputusan yang lewat `expires_at` tidak pernah dieksekusi (Schema.md §3);
            Supervisor mengulang dari DETECT dengan data terbaru.
          </span>
        )}
        {recommendation.sapPurchaseOrder && (
          <span className="text-muted-foreground">
            SAP PO {recommendation.sapPurchaseOrder.poNumber} (
            {recommendation.sapPurchaseOrder.status})
          </span>
        )}
      </div>
    );
  }

  // Read-only user (bgn_monitor) — tampilkan status tanpa tombol aksi
  if (!userCanApprove) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4">
        <span className="font-medium text-navy-900">Status keputusan:</span>
        <StatusBadge kind="decision" value={recommendation.status} />
        <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
          Read-only — akun Anda tidak memiliki hak approve
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold text-navy-900">Keputusan Anda</h2>

      {canApprove && !permitted && (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-navy-900">
          <ShieldAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-navy-700"
            aria-hidden
          />
          <span>
            {denialReason === "outside-sppg"
              ? `Lokasi tujuan (${locationLabel(recommendation.targetLocationId)}) bukan SPPG Anda — approval dilakukan Kepala/Ahli Gizi SPPG di lokasi tersebut.`
              : `Anda tidak punya hak approval untuk lokasi tujuan ini (${locationLabel(recommendation.targetLocationId)}).`}
          </span>
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
              : isExclusion
                ? "Berlakukan eksklusi"
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
