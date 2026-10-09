"use client";

import { useState } from "react";
import { Download, Recycle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buildReport, reportFileName, type ExportColumn } from "@/lib/export";
import { formatRemaining } from "@/lib/four-hour";
import { formatTime } from "@/lib/format";
import {
  MOCK_BATCHES,
  MOCK_SURPLUS_TARGETS,
  fromOffset,
  type MockBatch,
} from "@/lib/mock-compliance";
import { planSurplus, TARGET_KIND_LABELS } from "@/lib/surplus";

type SurplusExportRow = {
  tujuan: string;
  jenis: string;
  tibaMenit: number;
  diterima: number;
  status: string;
};

const EXPORT_COLUMNS: ExportColumn<SurplusExportRow>[] = [
  { key: "tujuan", header: "Tujuan" },
  { key: "jenis", header: "Jenis" },
  { key: "tibaMenit", header: "Tiba dalam menit" },
  { key: "diterima", header: "Diterima porsi" },
  { key: "status", header: "Status jendela" },
];

const WASTE_LAW = "Peraturan BGN No. 1 Tahun 2026";

/** Unduh CSV tanpa dependency: Blob → object URL → anchor sementara. */
function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Panel surplus pangan. Alokasi dihitung planSurplus (lib/surplus.ts): surplus
 * hanya boleh dialihkan bila MASIH di dalam jendela aman 4 jam saat tiba.
 */
export function SurplusPanel({
  now,
  batches = MOCK_BATCHES,
}: {
  now: number;
  /**
   * Batch yang boleh dipilih. Halaman mengirim batch yang SUDAH disaring cakupan peran
   * (`lib/region-map.ts`); bawaannya data mock penuh supaya komponen tetap bisa dipakai
   * sendiri (mis. di test/demo).
   */
  batches?: MockBatch[];
}) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [portions, setPortions] = useState(150);

  const batch = batches.find((item) => item.id === batchId) ?? batches[0];

  /**
   * Tidak ada batch di cakupan peran (mis. kepala SPPG wilayah yang belum punya batch
   * demo) → jelaskan, jangan hitung rencana dari batch wilayah lain atau batch kosong.
   */
  if (!batch) {
    return (
      <EmptyState
        title="Belum ada batch di wilayah Anda"
        description="Rencana alokasi sisa pangan hanya bisa disusun untuk batch yang berada di cakupan peran Anda. Batch wilayah lain tidak ditampilkan di sini."
      />
    );
  }

  const plan = planSurplus({
    surplusPortions: portions,
    cookedAt: fromOffset(now, batch.cookedAtOffsetMin),
    now,
    candidates: MOCK_SURPLUS_TARGETS,
  });

  function handleExport() {
    const rows: SurplusExportRow[] = plan.rows.map((row) => ({
      tujuan: row.candidate.name,
      jenis: TARGET_KIND_LABELS[row.candidate.kind],
      tibaMenit: row.candidate.travelMinutes,
      diterima: row.acceptedPortions,
      status: row.note,
    }));
    const content = buildReport({
      title: `Rencana alokasi surplus batch ${batch.id}`,
      generatedAt: now,
      columns: EXPORT_COLUMNS,
      rows,
      notes: [plan.wasteNote, `Dasar hukum: ${WASTE_LAW}`],
      includeBom: true,
    });
    downloadCsv(reportFileName("surplus", now), content);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Rencana alokasi surplus</CardTitle>
          <p className="text-muted-foreground">
            Sisa pangan hanya dialihkan bila masih dalam jendela aman 4 jam saat
            tiba di penerima.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" aria-hidden />
          Unduh laporan CSV
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-navy-900">Batch:</span>
            {batches.map((item) => (
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
          <label className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
            Jumlah porsi sisa:
            <input
              type="number"
              min={0}
              value={portions}
              onChange={(event) => setPortions(Number(event.target.value) || 0)}
              className="h-9 w-32 rounded-md border border-input bg-card px-2 text-sm tabular-nums text-navy-900"
            />
          </label>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="flex items-center gap-2 font-medium text-navy-900">
            <Recycle className="h-4 w-4" aria-hidden />
            Rekomendasi tujuan
          </p>
          {plan.recommended ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-navy-900">
                {plan.recommended.candidate.name}
              </span>
              <Badge tone="info">
                {TARGET_KIND_LABELS[plan.recommended.candidate.kind]}
              </Badge>
              <span className="text-muted-foreground">
                tiba ~
                {formatTime(
                  new Date(plan.recommended.arrivesAt).toISOString(),
                )}
              </span>
              <span className="text-muted-foreground">
                sisa jendela{" "}
                {formatRemaining(plan.recommended.remainingOnArrivalMs)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{plan.reason}</p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-grey-500">
                <th className="py-2 pr-3 font-medium">Tujuan</th>
                <th className="py-2 pr-3 font-medium">Jenis</th>
                <th className="py-2 pr-3 font-medium">Tiba (menit)</th>
                <th className="py-2 pr-3 font-medium">Diterima</th>
                <th className="py-2 font-medium">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((row) => (
                <tr
                  key={row.candidate.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="py-2 pr-3 text-navy-900">
                    {row.candidate.name}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {TARGET_KIND_LABELS[row.candidate.kind]}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-navy-900">
                    {row.candidate.travelMinutes}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-navy-900">
                    {row.acceptedPortions} porsi
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {row.note}
                    {!row.withinWindow && (
                      <>
                        {" "}
                        <span>
                          (tiba {row.candidate.travelMinutes} menit, setelah batas 4 jam)
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-navy-900">
          <span>
            Teralokasi:{" "}
            <span className="font-semibold tabular-nums">
              {plan.allocatedPortions}
            </span>{" "}
            porsi
          </span>
          <span>
            Tidak teralokasi:{" "}
            <span className="font-semibold tabular-nums">
              {plan.unallocatedPortions}
            </span>{" "}
            porsi
          </span>
        </div>

        <div className="rounded-md bg-navy-100 p-3 text-sm">
          <p className="font-medium text-navy-900">{plan.wasteNote}</p>
        </div>
      </CardContent>
    </Card>
  );
}
