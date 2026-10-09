"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AgentScorecard } from "@/components/quality/agent-scorecard";
import { MOCK_AGENT_RUNS } from "@/lib/mock-compliance";
import type { AgentRun } from "@/lib/quality";

/**
 * Halaman Kualitas Agen — kualitas diukur dan ditampilkan, bukan diklaim.
 *
 * Skorcard agregat di atas, rincian per run di bawah, dan catatan cara penilaian
 * (LLM-as-judge vs evaluator kode) ada di dalam AgentScorecard.
 */
const VERIFIER: Record<
  AgentRun["verifierAgreement"],
  { label: string; tone: "safe" | "warning" | "danger" }
> = {
  agree: { label: "Setuju", tone: "safe" },
  disagree: { label: "Tidak setuju", tone: "danger" },
  unavailable: { label: "Tidak tersedia", tone: "warning" },
};

export default function QualityPage() {
  const runs = MOCK_AGENT_RUNS;

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-xl font-semibold text-navy-900">Kualitas Agen</h1>
          <p className="text-muted-foreground">
            Halaman ini menunjukkan bagaimana kualitas agen diukur, bukan sekadar
            diklaim. Setiap run dicatat: berapa langkah yang ditempuh, berapa kali
            agen jatuh ke model cadangan, apakah verifier menyetujui, dan apakah
            titik kendali kritis (CCP) lolos.
          </p>
        </div>
        <DataSourceBadge />
      </div>

      <AgentScorecard runs={runs} />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-navy-900">Rincian per run</h2>
        {runs.length === 0 ? (
          <EmptyState
            title="Belum ada run tercatat"
            description="Skorcard dan rincian akan terisi begitu agen menjalankan langkah pertamanya."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {runs.map((run) => {
              const verifier = VERIFIER[run.verifierAgreement];
              return (
                <Card key={run.id}>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm text-navy-900">
                        {run.id}
                      </span>
                      <Badge tone={run.ccpCompliant ? "safe" : "danger"}>
                        {run.ccpCompliant ? "CCP patuh" : "CCP tidak patuh"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Langkah</span>
                        <span className="tabular-nums font-medium text-navy-900">
                          {run.steps}
                        </span>
                      </span>
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Fallback</span>
                        <span className="tabular-nums font-medium text-navy-900">
                          {run.fallbacks}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Hasil verifier
                      </span>
                      <Badge tone={verifier.tone}>{verifier.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
