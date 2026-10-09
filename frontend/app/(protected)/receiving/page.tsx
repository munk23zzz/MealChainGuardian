"use client";

import { ReceivingForm } from "@/components/receiving/receiving-form";
import { RoleGate } from "@/components/layout/role-gate";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Receiving Inspection (design.md §3.5b) — Ahli Gizi/Kepala SPPG mencatat kondisi
 * barang yang baru tiba. Halaman ini yang membuat langkah LEARN punya masukan
 * nyata: hasilnya mengisi `decisions.outcome` dan menggerakkan reliability_score.
 */
export default function ReceivingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up">
        <h1 className="text-xl font-semibold text-navy-900">Penerimaan Barang</h1>
        <p className="text-muted-foreground">
          Catat kondisi barang yang baru tiba: suhu terukur dan kondisi fisik.
          Hasilnya menjadi bukti <span className="font-mono">human_inspection</span>{" "}
          dan mengisi <span className="font-mono">decisions.outcome</span> — dasar
          penyesuaian skor kepercayaan pemasok (LEARN, Skill.md §10).
        </p>
      </div>

      <RoleGate
        allowedRoles={["sppg_head", "sppg_nutritionist"]}
        fallback={
          <EmptyState
            title="Pencatatan penerimaan dilakukan Kepala/Ahli Gizi SPPG"
            description="Role Anda hanya melihat (read-only). Bukti dan skor pemasok tetap bisa dibaca di layar Keputusan dan Pemasok — otorisasi ini ditegakkan backend, bukan hanya UI."
          />
        }
      >
        <ReceivingForm />
      </RoleGate>
    </div>
  );
}
