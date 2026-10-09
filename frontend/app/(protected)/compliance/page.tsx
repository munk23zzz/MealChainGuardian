"use client";

import { useEffect, useState } from "react";
import { CcpBoard } from "@/components/compliance/ccp-board";
import { FourHourTimeline } from "@/components/compliance/four-hour-timeline";
import { HazardMatrix } from "@/components/compliance/hazard-matrix";
import { SampleBankCard } from "@/components/compliance/sample-bank-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { BIZ_STEP_LABELS, sortByTime } from "@/lib/epcis";
import { formatDateTime } from "@/lib/format";
import {
  MOCK_BATCHES,
  MOCK_SAMPLE_BANK,
  journeyEvents,
  readingsForBatch,
} from "@/lib/mock-compliance";

const COMMODITY_KEYWORDS = [
  "Nasi",
  "Ayam",
  "Telur",
  "Tahu",
  "Tempe",
  "Sayur",
  "Mie",
  "Bakso",
];

/** Komoditas menu batch yang punya catatan bahaya di lib/hazards.ts. */
function commoditiesForMenu(menu: string): string[] {
  const text = menu.toLowerCase();
  return COMMODITY_KEYWORDS.filter((item) => text.includes(item.toLowerCase()));
}

/**
 * Keamanan Pangan: bukti CCP, jendela aman 4 jam, matriks bahaya, bank sampel,
 * dan jejak lot EPCIS untuk batch terpilih. Semua waktu memakai `now` dari
 * useEffect supaya tidak ada mismatch hidrasi.
 */
export default function CompliancePage() {
  const [now, setNow] = useState<number | null>(null);
  const [batchId, setBatchId] = useState(MOCK_BATCHES[0].id);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  if (now === null) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonCard />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard />
      </div>
    );
  }

  const batch =
    MOCK_BATCHES.find((item) => item.id === batchId) ?? MOCK_BATCHES[0];

  if (!batch) {
    return (
      <EmptyState
        title="Belum ada batch"
        description="Tidak ada batch yang bisa ditampilkan."
      />
    );
  }

  const readings = readingsForBatch(batch.id);
  const commodities = commoditiesForMenu(batch.menu);
  const events = sortByTime(journeyEvents(now));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">
            Keamanan Pangan
          </h1>
          <p className="text-muted-foreground">
            Bukti CCP, jendela aman masak → konsumsi, matriks bahaya, bank sampel,
            dan jejak lot EPCIS untuk batch yang dipilih.
          </p>
        </div>
        <DataSourceBadge />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-navy-900">Batch:</span>
        {MOCK_BATCHES.map((item) => (
          <Button
            key={item.id}
            variant={item.id === batch.id ? "default" : "outline"}
            size="sm"
            onClick={() => setBatchId(item.id)}
          >
            {item.id}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CcpBoard batchId={batch.id} readings={readings} now={now} />
        <FourHourTimeline batch={batch} now={now} />
      </div>

      <HazardMatrix commodities={commodities} />

      <SampleBankCard entries={MOCK_SAMPLE_BANK} now={now} />

      <Card>
        <CardHeader className="space-y-0">
          <CardTitle>Jejak lot EPCIS</CardTitle>
          <p className="text-muted-foreground">
            Kejadian rantai pasok satu lot dari gudang sampai dapur, dalam bentuk
            what / where / when / why (GS1 EPCIS).
          </p>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-4">
            {events.map((event) => (
              <li key={event.eventId} className="flex gap-3">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy-900">
                      {BIZ_STEP_LABELS[event.bizStep]}
                    </span>
                    <span className="tabular-nums text-xs text-grey-500">
                      {formatDateTime(new Date(event.when).toISOString())}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-navy-900">{event.what}</p>
                  <p className="text-sm text-muted-foreground">
                    {event.where} · {event.why}
                  </p>
                  <p className="mt-1 text-xs text-grey-500">
                    Lot {event.lot} · GTIN {event.gtin} · GLN {event.gln}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
