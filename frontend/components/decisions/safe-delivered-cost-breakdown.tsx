import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCostRows, costTotalMatches, sumCostRows } from "@/lib/cost";
import { formatPercent, formatRupiah } from "@/lib/format";
import type { CandidateCostBreakdown } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

function CandidateCostCard({
  candidate,
  isWinner,
  winnerTotal,
  maxTotal,
  index,
}: {
  candidate: CandidateCostBreakdown;
  isWinner: boolean;
  /** Total kandidat terpilih — dasar hitung "berapa lebih mahal". */
  winnerTotal: number | null;
  /** Total tertinggi di antara kandidat — dasar skala bar. */
  maxTotal: number;
  /** Urutan render, untuk animation-delay bertahap. */
  index: number;
}) {
  const rows = buildCostRows(candidate);
  const total = sumCostRows(rows);
  const consistent = costTotalMatches(candidate);
  const share = maxTotal > 0 ? Math.max((total / maxTotal) * 100, 6) : 0;
  const delta = winnerTotal !== null ? total - winnerTotal : 0;

  return (
    <div
      className={cn(
        "animate-fade-up rounded-xl border p-3 transition-colors",
        isWinner
          ? "border-brand/40 bg-brand/[0.04] ring-1 ring-brand/20"
          : "border-border hover:border-navy-700/30",
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
            <span className="truncate">{candidate.supplierId}</span>
            {isWinner && (
              <Badge tone="safe">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Terpilih · termurah
              </Badge>
            )}
            {!isWinner && winnerTotal !== null && (
              <Badge tone="neutral">+{formatRupiah(delta)}/kg lebih mahal</Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {candidate.distanceKm} km · ETA {candidate.etaMinutes} menit · kelengkapan
            bukti {formatPercent(candidate.evidenceCompleteness)}
          </p>
        </div>

        <p className="shrink-0 text-right">
          <span className="block text-lg font-semibold tabular-nums text-navy-900">
            {formatRupiah(total)}
            <span className="text-xs font-normal text-muted-foreground">/kg</span>
          </span>
          <span className="text-xs text-muted-foreground">
            backend {formatRupiah(candidate.totalSafeDeliveredCostPerKg)}
          </span>
        </p>
      </div>

      {/* Bar relatif: makin panjang = makin mahal (skala ke kandidat termahal). */}
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-navy-100/70"
        role="img"
        aria-label={`Total ${formatRupiah(total)} per kg, ${Math.round(
          share,
        )}% dari kandidat termahal`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            isWinner ? "bg-brand" : "bg-navy-700/40",
          )}
          style={{ width: `${share}%` }}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="mt-2 w-full">
          <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-2 text-sm text-muted-foreground">
                {row.label}
              </td>
              <td className="py-1.5 text-right text-sm tabular-nums text-navy-900">
                {formatRupiah(row.amountPerKg)}
                {row.missing && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (belum dilaporkan)
                  </span>
                )}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="py-2 pr-2 text-navy-900">Total Safe Delivered Cost</td>
            <td className="py-2 text-right tabular-nums text-navy-900">
              {formatRupiah(total)}/kg
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      {!consistent && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-sm text-navy-900">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-danger"
            aria-hidden
          />
          <span>
            Jumlah komponen ({formatRupiah(total)}) tidak sama dengan total dari
            backend ({formatRupiah(candidate.totalSafeDeliveredCostPerKg)}) — angka
            ditampilkan apa adanya, tidak dibetulkan diam-diam.
          </span>
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
  const winner = candidates.find((c) => c.candidateId === winnerId) ?? null;
  const totals = candidates.map((c) => sumCostRows(buildCostRows(c)));
  const maxTotal = totals.length > 0 ? Math.max(...totals) : 0;
  const winnerTotal = winner
    ? sumCostRows(buildCostRows(winner))
    : totals.length > 0
      ? Math.min(...totals)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-muted-foreground">
          Perbandingan kandidat pemasok, per kg yang sampai dengan aman. Bar lebih
          panjang = lebih mahal; kandidat ber-ring biru adalah pilihan sistem.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {candidates.length === 0 ? (
          <p className="text-muted-foreground">
            Belum ada kandidat pemasok yang lolos hard constraint, jadi breakdown
            biaya belum bisa dihitung.
          </p>
        ) : (
          candidates.map((c, i) => (
            <CandidateCostCard
              key={c.candidateId}
              candidate={c}
              isWinner={winnerId === c.candidateId}
              winnerTotal={winnerTotal}
              maxTotal={maxTotal}
              index={i}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
