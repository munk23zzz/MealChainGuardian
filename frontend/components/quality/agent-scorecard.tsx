import { Card, CardContent } from "@/components/ui/card";
import {
  agentScorecard,
  formatRate,
  scorecardTones,
  type AgentRun,
} from "@/lib/quality";
import { cn } from "@/lib/utils";

/**
 * Kartu angka kualitas agen (padanan ringan AgentCore Evaluations).
 *
 * Semua angka dihitung `agentScorecard` dan semua makna titik status dihitung
 * `scorecardTones` — keduanya di `lib/quality.ts`. Komponen ini hanya
 * menampilkan: tidak ada ambang yang ditulis ulang di sini.
 */
type DotTone = "safe" | "warning" | "danger" | "neutral";

const DOT_CLASS: Record<DotTone, string> = {
  safe: "bg-status-safe",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-grey-500",
};

type Metric = {
  key: string;
  label: string;
  value: string;
  hint: string;
  tone: DotTone;
};

export function AgentScorecard({ runs }: { runs: AgentRun[] }) {
  const scorecard = agentScorecard(runs);
  const tones = scorecardTones(scorecard);

  const metrics: Metric[] = [
    {
      key: "runs",
      label: "Jumlah run",
      value: String(scorecard.runs),
      hint: "percobaan agen yang tercatat",
      tone: "neutral",
    },
    {
      key: "steps",
      label: "Total langkah",
      value: String(scorecard.totalSteps),
      hint: "akumulasi langkah di semua run",
      tone: "neutral",
    },
    {
      key: "fallback",
      label: "Tingkat fallback",
      value: formatRate(scorecard.fallbackRate),
      hint: "langkah yang jatuh ke model cadangan",
      tone: tones.fallback,
    },
    {
      key: "agreement",
      label: "Kesesuaian agen dengan verifier",
      value: formatRate(scorecard.agreementRate),
      hint: "pendapat kedua verifier yang setuju",
      tone: tones.agreement,
    },
    {
      key: "override",
      label: "Keputusan yang diubah manusia",
      value: formatRate(scorecard.overrideRate),
      hint: "usulan agen yang diubah saat review",
      tone: tones.override,
    },
    {
      key: "ccp",
      label: "Kepatuhan CCP",
      value: formatRate(scorecard.ccpComplianceRate),
      hint: "run yang lolos titik kendali kritis",
      tone: tones.ccp,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.key}>
            <CardContent className="flex flex-col gap-1 p-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    DOT_CLASS[metric.tone],
                  )}
                />
                <span className="text-sm text-muted-foreground">
                  {metric.label}
                </span>
              </div>
              <span className="text-2xl font-semibold tabular-nums text-navy-900">
                {metric.value}
              </span>
              <span className="text-xs text-muted-foreground">
                {metric.hint}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <h2 className="font-semibold text-navy-900">Cara kami menilai</h2>
          <p className="text-muted-foreground">
            Kualitas alasan dinilai dengan LLM-as-judge — model penilai terpisah
            memberi skor pada penalaran agen — sementara ambang deterministik
            seperti batas 4 jam dan titik kendali keamanan diperiksa evaluator
            kode, bukan model bahasa, supaya hasilnya tidak bisa
            &quot;berkreasi&quot;. Semua angka di kartu ini berasal dari data
            simulasi (<span className="font-mono">MOCK_AGENT_RUNS</span>), jadi
            dibaca sebagai contoh cara pengukuran, bukan hasil produksi.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
