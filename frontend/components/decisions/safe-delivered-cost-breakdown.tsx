import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCostRows, costTotalMatches, sumCostRows } from "@/lib/cost";
import { formatRupiah } from "@/lib/format";
import type { CandidateCostBreakdown } from "@/lib/api/schema";

function CandidateCostTable({
  candidate,
  isWinner,
}: {
  candidate: CandidateCostBreakdown;
  isWinner: boolean;
}) {
  const rows = buildCostRows(candidate);
  const total = sumCostRows(rows);
  const consistent = costTotalMatches(candidate);

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span className="font-medium text-navy-900">
          {candidate.supplierId}
          {isWinner && (
            <span className="ml-2 inline-flex items-center gap-1 text-status-safe">
              <CheckCircle2 className="h-3.5 w-3.5" /> Terpilih
            </span>
          )}
        </span>
        <span className="text-muted-foreground">
          {candidate.distanceKm} km · ETA {candidate.etaMinutes} menit
        </span>
      </div>

      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-1.5">{row.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {formatRupiah(row.amountPerKg)}
                {row.missing && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (belum dilaporkan)
                  </span>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-muted/30 font-semibold">
            <td className="px-3 py-2">Total Safe Delivered Cost</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatRupiah(total)}/kg
            </td>
          </tr>
        </tbody>
      </table>

      {!consistent && (
        <p className="flex items-start gap-2 border-t border-status-warning/50 bg-status-warning/10 px-3 py-2 text-navy-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Jumlah komponen ({formatRupiah(total)}) tidak sama dengan total dari backend (
          {formatRupiah(candidate.totalSafeDeliveredCostPerKg)}).
        </p>
      )}
    </div>
  );
}

/**
 * SafeDeliveredCostBreakdown (design.md §3.3): tabel
 * purchase + transport + handling + expected loss + freshness risk + safety penalty = total.
 *
 * Angka datang apa adanya dari backend (Rules.md §1.1) — komponen ini tidak
 * menghitung ulang, hanya menjumlahkan untuk memverifikasi konsistensi.
 */
export function SafeDeliveredCostBreakdown({
  candidates,
  winnerId,
  title = "Safe Delivered Cost",
}: {
  candidates: CandidateCostBreakdown[];
  winnerId?: string;
  title?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-muted-foreground">
          Perbandingan kandidat pemasok, per kg yang sampai dengan aman.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {candidates.length === 0 ? (
          <p className="text-muted-foreground">
            Belum ada kandidat pemasok yang lolos hard constraint, jadi breakdown
            biaya belum bisa dihitung.
          </p>
        ) : (
          candidates.map((c) => (
            <CandidateCostTable
              key={c.candidateId}
              candidate={c}
              isWinner={winnerId === c.candidateId}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
