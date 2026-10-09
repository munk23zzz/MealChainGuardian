import { Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatRemaining,
  planDelivery,
  serveWindow,
  type WindowTone,
} from "@/lib/four-hour";
import { formatTime } from "@/lib/format";
import { fromOffset, type MockBatch } from "@/lib/mock-compliance";

const TONE_BAR: Record<WindowTone, string> = {
  safe: "bg-status-safe",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
};

const TONE_LABEL: Record<WindowTone, string> = {
  safe: "Dalam jendela aman",
  warning: "Jendela aman menipis",
  danger: "Di luar jendela aman",
};

/**
 * Jendela aman masak → konsumsi (BGN: maksimal 4 jam) untuk satu batch.
 *
 * Semua hitungan dari lib/four-hour.ts; komponen hanya menampilkan. Jendela
 * berakhir atau kiriman tiba setelah batas 4 jam berarti batch TIDAK BOLEH
 * dikonsumsi — ditulis tegas, bukan sekadar diwarnai.
 */
export function FourHourTimeline({
  batch,
  now,
}: {
  batch: MockBatch;
  now: number;
}) {
  const cookedAt = fromOffset(now, batch.cookedAtOffsetMin);
  const window = serveWindow(cookedAt, now);
  const delivery = planDelivery(cookedAt, now, batch.travelMinutes);
  const blocked = window.expired || !delivery.withinWindow;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Jendela aman masak → konsumsi</CardTitle>
          <p className="text-muted-foreground">
            Batch {batch.id} · matang{" "}
            {formatTime(new Date(cookedAt).toISOString())} · batas konsumsi 4 jam.
          </p>
        </div>
        <Badge tone={window.tone}>
          <Timer className="h-3 w-3" aria-hidden />
          {TONE_LABEL[window.tone]}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-navy-900">
              {formatRemaining(window.remainingMs)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(window.percentElapsed)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-navy-100">
            <div
              className={`h-full rounded-full ${TONE_BAR[window.tone]}`}
              style={{ width: `${window.percentElapsed}%` }}
            />
          </div>
        </div>

        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-navy-900">
            Perkiraan tiba di {batch.destination}
          </p>
          <p className="mt-1 text-muted-foreground">
            Berangkat sekarang, tiba sekitar{" "}
            {formatTime(new Date(delivery.arrivesAt).toISOString())} (tempuh{" "}
            {delivery.travelMinutes} menit).
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
            Sisa jendela saat tiba:
            <Badge tone={delivery.tone}>
              {formatRemaining(delivery.remainingOnArrivalMs)}
            </Badge>
          </p>
        </div>

        {blocked && (
          <p className="rounded-md bg-navy-100 p-3 text-sm font-medium text-navy-900">
            Batch {batch.id} tidak boleh dikonsumsi:{" "}
            {window.expired
              ? "jendela aman 4 jam sudah lewat"
              : "perjalanan tiba setelah jendela aman 4 jam berakhir"}
            . Catat penanganannya sebagai limbah sesuai Peraturan BGN No. 1 Tahun
            2026.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
