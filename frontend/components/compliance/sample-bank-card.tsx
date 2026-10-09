import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import { formatRemaining } from "@/lib/four-hour";
import { fromOffset, type SampleBankEntry } from "@/lib/mock-compliance";

const HOUR_MS = 60 * 60 * 1000;
const RETAIN_WARNING_MS = 12 * HOUR_MS;

type Tone = "safe" | "warning" | "danger";

/**
 * Bank sampel pangan matang — retensi 2×24 jam untuk investigasi KLB.
 * Sisa masa retensi dihitung dari waktu pengambilan (offset) + retainHours;
 * ditandai perhatian bila sisa kurang dari 12 jam.
 */
export function SampleBankCard({
  entries,
  now,
}: {
  entries: SampleBankEntry[];
  now: number;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Bank sampel kosong"
        description="Belum ada sampel pangan matang yang disimpan untuk investigasi."
      />
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle>Bank sampel pangan matang</CardTitle>
        <p className="text-muted-foreground">
          Sampel tiap batch wajib ditahan 2×24 jam untuk investigasi KLB sebelum
          dibuang.
        </p>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {entries.map((entry) => {
          const takenAt = fromOffset(now, entry.takenAtOffsetMin);
          const deadline = takenAt + entry.retainHours * HOUR_MS;
          const remainingMs = deadline - now;
          const expired = remainingMs <= 0;
          const tone: Tone = expired
            ? "danger"
            : remainingMs < RETAIN_WARNING_MS
              ? "warning"
              : "safe";

          return (
            <div key={entry.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-navy-900">
                  {entry.label}
                </span>
                <Badge tone={tone}>
                  {expired ? "Retensi berakhir" : formatRemaining(remainingMs)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-navy-900">{entry.menu}</p>
              <p className="mt-1 text-xs text-grey-500">
                Batch {entry.batchId} · {entry.locationName}
              </p>
              <p className="mt-1 text-xs text-grey-500">
                Diambil {formatDateTime(new Date(takenAt).toISOString())} ·
                retensi {entry.retainHours} jam
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
