import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { evaluateCcp, ruleById, summarizeCcp, type CcpRule } from "@/lib/ccp";
import { formatPercent, formatTime } from "@/lib/format";
import { fromOffset, type CcpReading } from "@/lib/mock-compliance";

type Tone = "safe" | "warning" | "danger";

const TONE_DOT: Record<Tone, string> = {
  safe: "bg-status-safe",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
};

const TONE_LABEL: Record<Tone, string> = {
  safe: "Semua titik sesuai standar",
  warning: "Ada titik yang perlu verifikasi",
  danger: "Ada titik yang gagal standar",
};

/**
 * Papan bukti CCP (Critical Control Point) untuk satu batch.
 *
 * Ambang tidak dihitung di sini: `evaluateCcp` memakai angka resmi dari
 * lib/ccp.ts. Nilai `null` berarti BELUM DIUKUR — ditampilkan apa adanya dan
 * tetap ditandai perlu verifikasi, bukan dianggap aman.
 */
export function CcpBoard({
  batchId,
  readings,
  now,
}: {
  batchId: string;
  readings: CcpReading[];
  now: number;
}) {
  const evaluated = readings
    .map((reading) => {
      const rule: CcpRule | undefined = ruleById(reading.ruleId);
      if (!rule) return null;
      return { reading, rule, evaluation: evaluateCcp(rule, reading.value) };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (evaluated.length === 0) {
    return (
      <EmptyState
        title="Belum ada bukti CCP untuk batch ini"
        description="Titik kendali kritis dicatat saat proses berjalan; belum ada pengukuran tersimpan untuk batch yang dipilih."
      />
    );
  }

  const summary = summarizeCcp(evaluated.map((row) => row.evaluation));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Papan bukti CCP</CardTitle>
          <p className="text-muted-foreground">
            Batch {batchId} · tiap titik kendali dievaluasi terhadap ambang resmi
            Kemenkes/BGN.
          </p>
        </div>
        <Badge tone={summary.tone}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[summary.tone]}`}
            aria-hidden
          />
          {TONE_LABEL[summary.tone]}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-navy-900">
          <span>
            Sesuai: <span className="font-semibold tabular-nums">{summary.pass}</span>
          </span>
          <span>
            Mendekati: <span className="font-semibold tabular-nums">{summary.warn}</span>
          </span>
          <span>
            Gagal: <span className="font-semibold tabular-nums">{summary.fail}</span>
          </span>
          <span>
            Kepatuhan:{" "}
            <span className="font-semibold tabular-nums">
              {formatPercent(summary.compliancePercent)}
            </span>
          </span>
          <span className="text-muted-foreground">
            dari {summary.total} titik terukur
          </span>
        </div>

        <ul className="flex flex-col gap-3">
          {evaluated.map(({ reading, rule, evaluation }) => (
            <li
              key={`${rule.id}-${reading.measuredAtOffsetMin}`}
              className="rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      TONE_DOT[evaluation.tone]
                    }`}
                    aria-hidden
                  />
                  <span className="font-medium text-navy-900">{rule.label}</span>
                </div>
                <span className="tabular-nums text-sm text-navy-900">
                  {reading.value === null ? (
                    <span className="text-muted-foreground">Belum diukur</span>
                  ) : (
                    `${reading.value} ${rule.unit}`
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {evaluation.message}
              </p>
              <p className="mt-1 text-xs text-grey-500">
                Diukur{" "}
                {formatTime(
                  new Date(
                    fromOffset(now, reading.measuredAtOffsetMin),
                  ).toISOString(),
                )}{" "}
                · sumber: {rule.source}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
