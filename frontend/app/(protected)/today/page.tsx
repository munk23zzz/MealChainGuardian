"use client";

import { useMemo } from "react";
import { TaskList, type TaskItem } from "@/components/today/task-list";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { useDecisions, useLocations } from "@/hooks/use-data";
import { evaluateCcp, ruleById } from "@/lib/ccp";
import { MOCK_BATCHES, readingsForBatch } from "@/lib/mock-compliance";
import { partitionBatchesByScope } from "@/lib/region-map";
import { scopeForRole } from "@/lib/role";
import { decisionTouchesScope } from "@/lib/scope";

/**
 * Layar lapangan "Hari Ini" — dua hal yang perlu dikerjakan dari ponsel di dapur:
 * menindak keputusan yang menunggu persetujuan, dan memeriksa titik keamanan pangan
 * yang belum sesuai. (Pencatatan penerimaan pernah direncanakan di layar ini, tetapi
 * jalur penerimaan TIDAK ada di kontrak yang berlaku sejak revisi dokumen 9 Okt —
 * jangan dihidupkan kembali tanpa keputusan pemilik proyek.)
 *
 * Semua angka dihitung dari modul lib yang ada (cakupan peran + evaluasi CCP), tidak ada
 * ambang yang dikarang di komponen. Hitungan CCP ikut cakupan peran: sebelumnya ia
 * menjumlahkan SEMUA batch demo, sehingga kepala SPPG DKI Jakarta menerima peringatan
 * keamanan pangan dari dapur wilayah lain.
 */
export default function TodayPage() {
  const { role, region, locationId, canApprove } = useAuth();
  const decisionsQuery = useDecisions();
  const locationsQuery = useLocations();

  const decisions = useMemo(
    () => decisionsQuery.data ?? [],
    [decisionsQuery.data],
  );
  const locations = useMemo(
    () => locationsQuery.data ?? [],
    [locationsQuery.data],
  );

  const scope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );

  /** Keputusan dalam cakupan peran yang butuh tindakan manusia. */
  const pendingCount = useMemo(
    () =>
      decisions.filter(
        (decision) =>
          decisionTouchesScope(decision, scope, locations) &&
          (decision.status === "pending_approval" ||
            decision.status === "verifier_flagged"),
      ).length,
    [decisions, scope, locations],
  );

  /** Batch demo dalam cakupan peran; sisanya disebut jumlahnya, bukan dihitung. */
  const { inScope: scopedBatches, outOfScope: batchesOutside } = useMemo(
    () => partitionBatchesByScope(MOCK_BATCHES, scope),
    [scope],
  );

  /** Titik CCP gagal/mendekati batas, HANYA dari batch di cakupan peran. */
  const ccpIssueCount = useMemo(() => {
    let count = 0;
    for (const batch of scopedBatches) {
      for (const reading of readingsForBatch(batch.id)) {
        const rule = ruleById(reading.ruleId);
        if (!rule) continue;
        const evaluation = evaluateCcp(rule, reading.value);
        if (evaluation.status === "fail" || evaluation.status === "warn") {
          count += 1;
        }
      }
    }
    return count;
  }, [scopedBatches]);

  const tasks = useMemo<TaskItem[]>(() => {
    const list: TaskItem[] = [];

    if (pendingCount > 0) {
      list.push({
        id: "decisions",
        // Peran read-only (monitor BGN) tidak boleh ditawari "menunggu persetujuan Anda":
        // ia memang tak punya hak approve (lib/auth.ts), dan kalimat itu membuatnya
        // mencari tombol yang tidak pernah ada di layarnya.
        title: canApprove
          ? "Keputusan menunggu persetujuan Anda"
          : "Keputusan menunggu approver SPPG",
        detail: canApprove
          ? `${pendingCount} keputusan di cakupan Anda menunggu tindakan manusia.`
          : `${pendingCount} keputusan di cakupan Anda belum disetujui — peran Anda read-only, jadi ini daftar pantauan.`,
        href: "/decisions",
        tone: "warning",
        meta: canApprove
          ? "Termasuk yang ditandai verifier"
          : "Tanpa hak approve — hanya memantau",
      });
    }

    if (ccpIssueCount > 0) {
      list.push({
        id: "compliance",
        title: "Titik keamanan pangan belum sesuai",
        detail: `${ccpIssueCount} titik CCP di ${scopedBatches.length} batch ${scope.kind === "all" ? "seluruh wilayah" : "wilayah Anda"} berstatus gagal atau mendekati batas.`,
        href: "/compliance",
        tone: "danger",
        meta:
          batchesOutside.length > 0
            ? `Batch wilayah lain (${batchesOutside.length}) tidak dihitung di sini — rincian per batch ada di halaman Keamanan Pangan`
            : "Semua batch demo ada di wilayah Anda — rincian per batch ada di halaman Keamanan Pangan",
      });
    }

    return list;
  }, [
    pendingCount,
    ccpIssueCount,
    canApprove,
    scope.kind,
    scopedBatches.length,
    batchesOutside.length,
  ]);

  const header = (
    <div className="animate-fade-up flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-navy-900">Hari Ini</h1>
      <p className="max-w-2xl text-muted-foreground">
        Layar ini dirancang untuk dipakai dari ponsel di dapur: berisi hal yang
        perlu ditindak hari ini dari cakupan peran Anda
        {canApprove
          ? " — termasuk keputusan yang menunggu persetujuan Anda."
          : " — Anda memantau, tanpa hak approve."}
      </p>
    </div>
  );

  if (decisionsQuery.isPending || locationsQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <SkeletonRows rows={3} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {decisionsQuery.isError && (
        <p className="rounded-lg border border-border bg-card p-4 text-navy-900">
          Data keputusan sedang tidak bisa dimuat, jadi daftar tugas di bawah
          mungkin belum lengkap. Coba muat ulang halaman ini.
        </p>
      )}

      {tasks.length === 0 ? (
        <EmptyState
          title="Tidak ada tugas untuk hari ini"
          description="Tidak ada keputusan yang menunggu persetujuan Anda, dan tidak ada titik keamanan pangan yang berstatus gagal atau mendekati batas dalam cakupan Anda."
        />
      ) : (
        <TaskList tasks={tasks} />
      )}
    </div>
  );
}
