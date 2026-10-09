"use client";

import { useMemo } from "react";
import { TaskList, type TaskItem } from "@/components/today/task-list";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { useDecisions, useLocations } from "@/hooks/use-data";
import { evaluateCcp, ruleById } from "@/lib/ccp";
import { MOCK_BATCHES, readingsForBatch } from "@/lib/mock-compliance";
import { scopeForRole } from "@/lib/role";
import { decisionTouchesScope } from "@/lib/scope";

/**
 * Layar lapangan "Hari Ini" — tiga hal yang perlu dikerjakan dari ponsel di
 * dapur: mencatat penerimaan, menindak keputusan yang menunggu, dan memeriksa
 * titik keamanan pangan yang belum sesuai.
 *
 * Semua angka dihitung dari modul lib yang ada (cakupan peran + evaluasi CCP),
 * tidak ada ambang yang dikarang di komponen.
 */
export default function TodayPage() {
  const { role, region, locationId } = useAuth();
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
            decision.status === "verifier_flagged" ||
            decision.status === "verifier_unavailable"),
      ).length,
    [decisions, scope, locations],
  );

  /** Titik CCP berstatus gagal atau mendekati batas, dari semua batch dipantau. */
  const ccpIssueCount = useMemo(() => {
    let count = 0;
    for (const batch of MOCK_BATCHES) {
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
  }, []);

  const tasks = useMemo<TaskItem[]>(() => {
    const list: TaskItem[] = [];

    if (role === "sppg_head" || role === "sppg_nutritionist") {
      list.push({
        id: "receiving",
        title: "Catat penerimaan hari ini",
        detail:
          "Catat kondisi barang yang baru tiba: suhu terukur dan kondisi fisiknya.",
        href: "/receiving",
        tone: "safe",
        meta: "Kepala/Ahli Gizi SPPG",
      });
    }

    if (pendingCount > 0) {
      list.push({
        id: "decisions",
        title: "Keputusan menunggu persetujuan Anda",
        detail: `${pendingCount} keputusan di cakupan Anda menunggu tindakan manusia.`,
        href: "/decisions",
        tone: "warning",
        meta: "Termasuk yang ditandai verifier atau saat verifier tak tersedia",
      });
    }

    if (ccpIssueCount > 0) {
      list.push({
        id: "compliance",
        title: "Titik keamanan pangan belum sesuai",
        detail: `${ccpIssueCount} titik CCP di ${MOCK_BATCHES.length} batch hari ini berstatus gagal atau mendekati batas.`,
        href: "/compliance",
        tone: "danger",
        meta: "Akumulasi batch B-2026-1007-A/B/C — rincian per batch di halaman Keamanan Pangan",
      });
    }

    return list;
  }, [role, pendingCount, ccpIssueCount]);

  const header = (
    <div className="animate-fade-up flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-navy-900">Hari Ini</h1>
      <p className="max-w-2xl text-muted-foreground">
        Layar ini dirancang untuk dipakai dari ponsel di dapur, berisi tiga hal
        yang perlu dikerjakan hari ini.
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
          description="Tidak ada penerimaan yang harus dicatat, keputusan yang menunggu persetujuan, maupun titik keamanan pangan yang belum sesuai."
        />
      ) : (
        <TaskList tasks={tasks} />
      )}
    </div>
  );
}
