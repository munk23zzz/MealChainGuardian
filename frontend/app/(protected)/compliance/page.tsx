"use client";

import { useEffect, useMemo, useState } from "react";
import { CcpBoard } from "@/components/compliance/ccp-board";
import { FourHourTimeline } from "@/components/compliance/four-hour-timeline";
import { HazardMatrix } from "@/components/compliance/hazard-matrix";
import { SampleBankCard } from "@/components/compliance/sample-bank-card";
import { ScopeNotice } from "@/components/layout/scope-notice";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth";
import { useUrlParam } from "@/hooks/use-url-param";
import { BIZ_STEP_LABELS, sortByTime } from "@/lib/epcis";
import { formatDateTime } from "@/lib/format";
import {
  MOCK_BATCHES,
  MOCK_SAMPLE_BANK,
  journeyEvents,
  readingsForBatch,
} from "@/lib/mock-compliance";
import { partitionBatchesByScope } from "@/lib/region-map";
import { matchParamToIds } from "@/lib/view-params";
import { scopeForRole } from "@/lib/role";

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
 *
 * Cakupan peran (design.md §1.4): batch yang bisa dipilih dibatasi wilayah peran. Batch
 * demo hanya menyimpan nama tujuan (bukan `locationId`), jadi pemetaannya lewat
 * `lib/region-map.ts` yang murni dan teruji — bukan pencocokan teks di komponen ini.
 * Kepala SPPG DKI Jakarta memang tidak perlu membaca suhu dapur Bogor, dan sebaliknya.
 */
export default function CompliancePage() {
  const [now, setNow] = useState<number | null>(null);
  const { role, region, locationId, canApprove } = useAuth();
  const [showAllScopes, setShowAllScopes] = useState(false);
  // Batch terpilih ikut URL supaya tautan ke satu batch bisa dibagikan dan pilihan pulih
  // saat kembali (skill `deep-linking`/`state-preservation`). Saklar "tampilkan semua
  // wilayah" SENGAJA tidak masuk URL: ia memperluas cakupan peran, dan tautan seperti itu
  // akan menyebar ke orang yang tidak berhak (Rules.md §1.4).
  const [batchParam, setBatchParam] = useUrlParam("batch");

  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const effectiveScope = useMemo(
    () => (showAllScopes ? ({ kind: "all" } as const) : roleScope),
    [showAllScopes, roleScope],
  );
  const { inScope: scopedBatches, outOfScope } = useMemo(
    () => partitionBatchesByScope(MOCK_BATCHES, effectiveScope),
    [effectiveScope],
  );

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

  const header = (
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
      <div className="flex flex-wrap items-center gap-2">
        <CopyLinkButton label="Salin tautan batch" />
        <DataSourceBadge />
      </div>
    </div>
  );

  const notice = (
    <ScopeNotice
      scope={effectiveScope}
      outsideCount={outOfScope.length}
      detail={`${scopedBatches.length} dari ${MOCK_BATCHES.length} batch demo`}
      readOnly={!canApprove}
      canToggle={roleScope.kind !== "all"}
      showingAll={showAllScopes}
      roleScope={roleScope}
      onToggle={() => setShowAllScopes((value) => !value)}
    />
  );

  // Batch terpilih bisa jatuh di luar cakupan setelah peran/mode berubah, atau URL memuat id
  // di luar cakupan: `matchParamToIds` menolaknya dan kita jatuh ke batch pertama yang MASIH
  // dalam cakupan — bukan tetap menampilkan yang terlarang.
  const selectedId = matchParamToIds(
    batchParam,
    scopedBatches.map((item) => item.id),
  );
  const batch =
    scopedBatches.find((item) => item.id === selectedId) ?? scopedBatches[0];

  if (!batch) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {notice}
        <EmptyState
          title="Belum ada batch di wilayah Anda"
          description="Tidak ada batch demo di cakupan peran Anda, jadi tidak ada bukti CCP yang bisa ditampilkan. Batch wilayah lain sengaja tidak dibuka di sini."
          action={
            roleScope.kind !== "all" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllScopes(true)}
              >
                Tampilkan semua wilayah
              </Button>
            )
          }
        />
      </div>
    );
  }

  const readings = readingsForBatch(batch.id);
  const commodities = commoditiesForMenu(batch.menu);
  const events = sortByTime(journeyEvents(now));

  return (
    <div className="flex flex-col gap-6">
      {header}

      {notice}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-navy-900">Batch:</span>
        {scopedBatches.map((item) => (
          <Button
            key={item.id}
            variant={item.id === batch.id ? "default" : "outline"}
            size="sm"
            onClick={() => setBatchParam(item.id)}
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
