"use client";

import { CheckCircle2, Info, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status/status-badge";
import { useSupplier } from "@/hooks/use-data";
import { formatDateTime, formatKg, formatRupiah } from "@/lib/format";
import { latestPriceByCommodity, summariseSupplierDetail } from "@/lib/supplier-detail";
import type { SupplierBatch } from "@/lib/api/schema";

/**
 * Panel Detail Pemasok (halaman `/suppliers`).
 *
 * Sumbernya `GET /ui/suppliers/{id}` — batch, kuotasi harga, purchase order, dan riwayat usulan
 * eksklusi. Semua angka ditampilkan apa adanya dari data; yang kosong diberi kalimat, bukan angka
 * netral (\"0 PO\" hanya jika memang nol, \"belum ada\" jika sumbernya belum ada).
 */

const FRESHNESS_LABEL: Record<NonNullable<SupplierBatch["freshnessStatus"]>, string> = {
  fresh: "Segar",
  approaching_expiry: "Menjelang kedaluwarsa",
  expired: "Kedaluwarsa",
};

const FRESHNESS_TONE: Record<NonNullable<SupplierBatch["freshnessStatus"]>, "safe" | "warning" | "danger"> = {
  fresh: "safe",
  approaching_expiry: "warning",
  expired: "danger",
};

const SAFETY_LABEL: Record<string, string> = {
  PASS: "Aman",
  FAIL: "Gagal",
  NEEDS_VERIFICATION: "Perlu verifikasi",
  PENDING: "Belum diperiksa",
};

function Baris({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border py-2 first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums text-navy-900">{value}</span>
    </div>
  );
}

function Bagian({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold text-navy-900">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

export function SupplierDetailPanel({
  supplierId,
  open,
  onOpenChange,
  locationLabel = (id) => id,
  commodityLabel = (id) => id,
}: {
  supplierId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationLabel?: (id: string) => string;
  commodityLabel?: (id: string) => string;
}) {
  const { data, error, isPending, isFetching, refetch } = useSupplier(supplierId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data ? data.supplier.name : "Detail pemasok"}</DialogTitle>
          <DialogDescription>
            Isi panel ini datang dari data yang tersimpan (batch, kuotasi harga, purchase order,
            riwayat usulan eksklusi) — tidak ada angka yang ditaksir di layar.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <ErrorState
            message={(error as Error).message}
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        )}

        {!error && (isPending || !data) && <SkeletonCard />}

        {!error && data && (
          <div className="flex flex-col gap-6">
            {/* --- identitas & status --- */}
            <div className="flex flex-wrap items-center gap-2">
              {data.supplier.status === "excluded" ? (
                <Badge tone="danger">Dikecualikan</Badge>
              ) : (
                <Badge tone="safe">Aktif</Badge>
              )}
              <span className="text-muted-foreground">
                {locationLabel(data.supplier.locationId)} · skor kepercayaan{" "}
                <span className="tabular-nums font-semibold text-navy-900">
                  {data.supplier.reliabilityScore.toFixed(2)}
                </span>{" "}
                <span className="font-mono text-xs">suppliers.reliability_score</span>
              </span>
            </div>

            {data.supplier.status === "excluded" && (
              <p className="rounded-md border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-navy-900">
                Dikecualikan{data.supplier.excludedAt ? ` sejak ${formatDateTime(data.supplier.excludedAt)}` : ""}
                {data.supplier.exclusionReason ? `: ${data.supplier.exclusionReason}` : "."} Pemasok ini
                tidak lagi dipilih untuk purchase order berikutnya.
              </p>
            )}

            {/* --- ringkasan --- */}
            {(() => {
              const ringkas = summariseSupplierDetail(data);
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <Baris label="Batch yang dipasok" value={ringkas.batchCount} />
                    <Baris label="Total volume" value={formatKg(ringkas.totalQuantityKg)} />
                    <Baris
                      label="Skor kesegaran terendah"
                      value={
                        ringkas.lowestFreshnessScore === null
                          ? "belum dinilai"
                          : ringkas.lowestFreshnessScore.toFixed(2)
                      }
                    />
                  </div>
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <Baris
                      label="Batch bermasalah aman"
                      value={
                        ringkas.safetyIssueCount === 0 ? (
                          <span className="text-status-safe">0</span>
                        ) : (
                          <span className="text-status-danger">{ringkas.safetyIssueCount}</span>
                        )
                      }
                    />
                    <Baris label="Batch dengan suhu menyimpang" value={ringkas.excursionCount} />
                    <Baris label="Purchase order terbit" value={ringkas.purchaseOrderCount} />
                  </div>
                </div>
              );
            })()}

            {/* --- batch --- */}
            <Bagian
              title="Batch yang dipasok"
              hint="Kesegaran & batas layak pakai memakai aturan yang sama dengan halaman Pasokan, jadi satu batch tidak bisa tampil beda di dua tempat."
            >
              {data.batches.length === 0 ? (
                <p className="text-muted-foreground">
                  Belum ada baris batch untuk pemasok ini di master data.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Komoditas</th>
                        <th className="py-2 pr-3 font-medium">Jumlah</th>
                        <th className="py-2 pr-3 font-medium">Dipanen</th>
                        <th className="py-2 pr-3 font-medium">Layak sampai</th>
                        <th className="py-2 pr-3 font-medium">Kesegaran</th>
                        <th className="py-2 pr-3 font-medium">Keamanan</th>
                        <th className="py-2 font-medium">Suhu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.batches.map((batch) => (
                        <tr key={batch.id} className="border-t border-border">
                          <td className="py-2 pr-3 text-navy-900">
                            {commodityLabel(batch.commodityId)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-navy-900">
                            {formatKg(batch.quantityKg)}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {formatDateTime(batch.harvestedAt)}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {formatDateTime(batch.usableUntil)}
                          </td>
                          <td className="py-2 pr-3">
                            {batch.freshnessStatus ? (
                              <span className="flex items-center gap-2">
                                <Badge tone={FRESHNESS_TONE[batch.freshnessStatus]}>
                                  {FRESHNESS_LABEL[batch.freshnessStatus]}
                                </Badge>
                                {batch.freshnessScore !== null && (
                                  <span className="tabular-nums text-muted-foreground">
                                    {batch.freshnessScore.toFixed(2)}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">belum dinilai</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-1.5">
                              {batch.safetyStatus === "PASS" ? (
                                <CheckCircle2
                                  className="h-3.5 w-3.5 text-status-safe"
                                  aria-hidden
                                />
                              ) : (
                                <XCircle
                                  className="h-3.5 w-3.5 text-status-danger"
                                  aria-hidden
                                />
                              )}
                              <span className="text-navy-900">
                                {SAFETY_LABEL[batch.safetyStatus] ?? batch.safetyStatus}
                              </span>
                            </span>
                          </td>
                          <td className="py-2">
                            {batch.temperatureExcursion ? (
                              <span className="flex items-center gap-1.5 text-status-danger">
                                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                                menyimpang
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {batch.temperatureReadings} pembacaan, normal
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bagian>

            {/* --- kuotasi harga --- */}
            <Bagian
              title="Kuotasi harga"
              hint="Dari price_signals dengan source='supplier_quote' — baris acuan pasar (PIHPS) tidak punya pemasok, jadi tidak muncul di sini."
            >
              {data.priceSignals.length === 0 ? (
                <p className="text-muted-foreground">
                  Belum ada kuotasi harga dari pemasok ini. Harga yang dipakai keputusan bisa saja
                  harga acuan pasar, bukan penawaran pemasok.
                </p>
              ) : (
                <div className="rounded-lg border border-border bg-card px-4 py-3">
                  {latestPriceByCommodity(data.priceSignals).map((signal) => (
                    <Baris
                      key={signal.commodityId}
                      label={commodityLabel(signal.commodityId)}
                      value={`${formatRupiah(signal.pricePerKg)}/kg · ${formatDateTime(signal.recordedAt)}`}
                    />
                  ))}
                </div>
              )}
            </Bagian>

            {/* --- purchase order --- */}
            <Bagian
              title="Purchase order SAP (mock)"
              hint="PO yang diterbitkan dari keputusan bersumber lokasi pemasok ini."
            >
              {data.purchaseOrders.length === 0 ? (
                <p className="text-muted-foreground">
                  Belum ada purchase order untuk pemasok ini di basis data.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Nomor PO</th>
                        <th className="py-2 pr-3 font-medium">Material</th>
                        <th className="py-2 pr-3 font-medium">Jumlah</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 font-medium">Dibuat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.purchaseOrders.map((po) => (
                        <tr key={po.poNumber} className="border-t border-border">
                          <td className="py-2 pr-3 font-mono text-navy-900">{po.poNumber}</td>
                          <td className="py-2 pr-3 font-mono text-muted-foreground">
                            {po.materialNumber}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-navy-900">
                            {formatKg(po.orderedQuantityKg)}
                          </td>
                          <td className="py-2 pr-3 text-navy-900">{po.status}</td>
                          <td className="py-2 text-muted-foreground">
                            {formatDateTime(po.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bagian>

            {/* --- riwayat eksklusi --- */}
            <Bagian
              title="Riwayat usulan eksklusi"
              hint="Termasuk usulan yang belum atau tidak disetujui (Rules.md §1.2) — menyembunyikannya akan membuat riwayat pemasok terlihat lebih bersih dari kenyataan."
            >
              {data.exclusionDecisions.length === 0 ? (
                <p className="text-muted-foreground">
                  Belum pernah ada usulan eksklusi untuk pemasok ini.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.exclusionDecisions.map((keputusan) => (
                    <div
                      key={keputusan.decisionId}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge kind="decision" value={keputusan.status} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {keputusan.decisionId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(keputusan.createdAt)}
                        </span>
                      </span>
                      {keputusan.reason && (
                        <span className="text-navy-900">{keputusan.reason}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Bagian>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Pemasok tidak bisa dikecualikan dari panel ini — eksklusi selalu lewat usulan +
                approval SPPG pemasok (Rules.md §1.2).
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
