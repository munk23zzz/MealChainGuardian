"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/status/status-badge";
import {
  useCommodities,
  useDecisions,
  useLocations,
  useSuppliers,
} from "@/hooks/use-data";
import { submitReceivingInspection } from "@/lib/api";
import { CaptureField, type CapturedPhoto } from "@/components/evidence/capture-field";
import { useToast } from "@/components/ui/toast";
import { QUEUE_LIMIT, createQueuedAction, enqueue } from "@/lib/offline-queue";
import { readQueue, writeQueue } from "@/components/ui/offline-banner";
import { formatFileSize } from "@/lib/image";
import type {
  ReceivingInspectionResult,
  Recommendation,
} from "@/lib/api/schema";
import { getWinningCandidate } from "@/lib/decisions";
import { useAuth } from "@/contexts/auth";
import { scopeForRole } from "@/lib/role";
import { decisionTouchesScope, scopeLabel } from "@/lib/scope";
import { commodityLabel, locationLabel } from "@/lib/labels";
import { parseSupplierId } from "@/lib/reliability";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kondisi fisik barang tiba (design.md §3.5b). */
const CONDITIONS = [
  { value: "baik", label: "Baik", hint: "Sesuai pesanan, tidak ada kerusakan" },
  {
    value: "rusak_sebagian",
    label: "Rusak sebagian",
    hint: "Ada bagian yang tidak layak dipakai",
  },
  { value: "rusak", label: "Rusak", hint: "Tidak bisa dipakai" },
] as const;

type Condition = (typeof CONDITIONS)[number]["value"];

/**
 * Receiving Inspection (design.md §3.5b).
 *
 * Hasil submit = evidence `human_inspection` baru + `decisions.outcome`. Kalau
 * kondisinya bukan "baik", muncul konfirmasi tambahan lebih dulu karena ini akan
 * menurunkan `reliability_score` pemasok (design.md §3.9c / Skill.md §10).
 */
export function ReceivingForm() {
  const queryClient = useQueryClient();
  const decisionsQuery = useDecisions();
  const locationsQuery = useLocations();
  const commoditiesQuery = useCommodities();
  const suppliersQuery = useSuppliers();

  const decisions = useMemo(
    () => decisionsQuery.data ?? [],
    [decisionsQuery.data],
  );
  const locations = useMemo(
    () => locationsQuery.data ?? [],
    [locationsQuery.data],
  );
  const commodities = useMemo(
    () => commoditiesQuery.data ?? [],
    [commoditiesQuery.data],
  );

  const { role, region, locationId } = useAuth();
  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );

  /**
   * Yang bisa dicatat penerimaannya: keputusan yang sudah disetujui/dieksekusi
   * dan berada di cakupan wilayah user (design.md §1.4) — penerimaan dicatat
   * SPPG penerima, jadi pengiriman ke wilayah lain bukan urusannya.
   */
  const receivable: Recommendation[] = useMemo(
    () =>
      decisions.filter(
        (d) =>
          (d.status === "approved" || d.status === "executed") &&
          decisionTouchesScope(d, roleScope, locations),
      ),
    [decisions, roleScope, locations],
  );

  const [decisionId, setDecisionId] = useState("");
  const [temp, setTemp] = useState("");
  const [condition, setCondition] = useState<Condition>("baik");
  const [note, setNote] = useState("");
  const [confirmingFailure, setConfirmingFailure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceivingInspectionResult | null>(null);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const { push } = useToast();

  const selected = receivable.find((d) => d.id === decisionId) ?? null;
  const winner = selected ? getWinningCandidate(selected) : null;
  const supplierId = parseSupplierId(winner?.supplierId);
  const supplier =
    suppliersQuery.data?.find((s) => s.id === supplierId) ?? null;

  const tempValue = Number.parseFloat(temp);
  const tempValid = temp.trim() !== "" && Number.isFinite(tempValue);
  const willFail = condition !== "baik";
  const canSubmit = Boolean(selected) && tempValid && !submitting;

  const reset = () => {
    setDecisionId("");
    setTemp("");
    setCondition("baik");
    setNote("");
    setConfirmingFailure(false);
    setError(null);
  };

  const doSubmit = async () => {
    if (!selected || !tempValid) return;
    setSubmitting(true);
    setError(null);

    /**
     * Jaringan dapur tidak bisa diasumsikan. Saat perangkat offline, pencatatan
     * masuk antrean lokal (lengkap dengan bukti foto) supaya tidak hilang, lalu
     * dikirim saat jaringan kembali — bukan gagal diam-diam.
     */
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const queue = readQueue();
      if (queue.length >= QUEUE_LIMIT) {
        setError(
          `Antrean lokal penuh (${QUEUE_LIMIT} aksi). Sambungkan internet untuk mengirim sebelum mencatat lagi.`,
        );
        setSubmitting(false);
        return;
      }
      const action = createQueuedAction(
        {
          kind: "receiving_inspection",
          label: `Penerimaan ${selected.id}`,
          payload: {
            decisionId: selected.id,
            measuredTempC: tempValue,
            physicalCondition: condition,
            note: note.trim() || undefined,
            photo: photo
              ? {
                  width: photo.width,
                  height: photo.height,
                  bytes: photo.bytes,
                  dataUrl: photo.dataUrl,
                }
              : undefined,
          },
        },
        Date.now(),
        `local-${Date.now()}`,
      );
      writeQueue(enqueue(queue, action));
      push({
        title: "Tersimpan di perangkat",
        description:
          "Pencatatan masuk antrean lokal dan akan dikirim saat jaringan kembali.",
        tone: "warning",
      });
      reset();
      setPhoto(null);
      setSubmitting(false);
      return;
    }

    try {
      const res = await submitReceivingInspection({
        decisionId: selected.id,
        measuredTempC: tempValue,
        physicalCondition: condition,
        note: note.trim() || undefined,
      });
      setResult(res);
      setConfirmingFailure(false);
      setPhoto(null);
      push({
        title: "Penerimaan tercatat",
        description: `Evidence ${res.evidenceId} dibuat dan skor kepercayaan pemasok diperbarui.`,
        tone: res.outcome === "success" ? "success" : "danger",
      });
      // Setelah LEARN berjalan, skor pemasok & daftar keputusan berubah.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-events"] }),
        queryClient.invalidateQueries({ queryKey: ["decisions"] }),
      ]);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSubmitting(false);
    }
  };

  const loading =
    decisionsQuery.isPending || locationsQuery.isPending || suppliersQuery.isPending;

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        {result && (
          <Card
            className={cn(
              "animate-fade-up border-l-4",
              result.outcome === "success"
                ? "border-l-status-safe"
                : "border-l-status-danger",
            )}
          >
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              {result.outcome === "success" ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-status-safe"
                  aria-hidden
                />
              ) : (
                <AlertTriangle
                  className="h-4 w-4 shrink-0 text-status-danger"
                  aria-hidden
                />
              )}
              <CardTitle>
                Penerimaan tercatat:{" "}
                {result.outcome === "success" ? "sukses" : "gagal"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-navy-900">
              <p>
                Evidence baru <span className="font-mono">{result.evidenceId}</span>{" "}
                (tipe <span className="font-mono">human_inspection</span>) dan{" "}
                <span className="font-mono">decisions.outcome</span> sudah diisi.
              </p>
              {result.affectsSupplierReliability && (
                <p className="text-muted-foreground">
                  Karena hasilnya gagal, langkah LEARN menurunkan{" "}
                  <span className="font-mono">reliability_score</span> pemasok
                  kandidat terpilih. Lihat perubahannya di{" "}
                  <Link href="/suppliers" className="text-brand hover:underline">
                    Riwayat Pemasok
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {receivable.length === 0 ? (
          <EmptyState
            title="Belum ada barang yang bisa dicatat"
            description="Form ini untuk keputusan yang sudah disetujui atau dieksekusi. Setujui dulu rekomendasi di feed, lalu catat kondisi barang saat tiba."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Catat kondisi barang tiba</CardTitle>
              <p className="text-muted-foreground">
                Satu pengiriman satu catatan (design.md §3.5b). Hasilnya jadi bukti
                fisik yang tidak bisa diubah agent.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="decision" className="text-sm font-medium text-navy-900">
                  Pengiriman
                </label>
                <select
                  id="decision"
                  value={decisionId}
                  onChange={(e) => {
                    setDecisionId(e.target.value);
                    setResult(null);
                    setConfirmingFailure(false);
                  }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-navy-900 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Pilih pengiriman…</option>
                  {receivable.map((d) => (
                    <option key={d.id} value={d.id}>
                      {locationLabel(d.sourceLocationId, locations)} →{" "}
                      {locationLabel(d.targetLocationId, locations)} ·{" "}
                      {commodityLabel(d.commodityId, commodities)} ·{" "}
                      {formatKg(d.quantityKg)}
                    </option>
                  ))}
                </select>
                {roleScope.kind !== "all" && (
                  <p className="text-xs text-muted-foreground">
                    Hanya pengiriman ke {scopeLabel(roleScope)} yang bisa Anda catat
                    penerimaannya.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="temp" className="text-sm font-medium text-navy-900">
                  Suhu terukur (°C)
                </label>
                <input
                  id="temp"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={temp}
                  onChange={(e) => setTemp(e.target.value)}
                  placeholder="mis. 4,5"
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm tabular-nums text-navy-900 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Ambang keamanan komoditas diperiksa sistem, bukan diketik ulang
                  manual.
                </p>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-navy-900">
                  Kondisi fisik
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CONDITIONS.map((c) => (
                    <label
                      key={c.value}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm transition-colors",
                        condition === c.value
                          ? "border-brand bg-brand/[0.06] ring-1 ring-brand/30"
                          : "border-border hover:border-navy-700/30",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium text-navy-900">
                        <input
                          type="radio"
                          name="condition"
                          value={c.value}
                          checked={condition === c.value}
                          onChange={() => {
                            setCondition(c.value);
                            setConfirmingFailure(false);
                          }}
                          className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                        />
                        {c.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="note" className="text-sm font-medium text-navy-900">
                  Catatan (opsional)
                </label>
                <textarea
                  id="note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="mis. kemasan penyok di 3 karung, bau tidak normal"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm text-navy-900 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {/*
                Bukti foto: dikompresi di perangkat dulu (kamera ponsel 4–8 MB →
                ratusan KB) supaya tetap terkirim di jaringan lapangan.
                Catatan jujur: lampiran foto belum termasuk kontrak API iterasi ini,
                jadi foto disimpan sebagai bukti lokal/antrean offline.
              */}
              <CaptureField
                label="Foto kondisi barang (opsional)"
                onChange={setPhoto}
              />
              {photo && (
                <p className="text-xs text-muted-foreground">
                  Foto siap dikirim: {photo.width}×{photo.height} px ·{" "}
                  {formatFileSize(photo.bytes)} (asli{" "}
                  {formatFileSize(photo.originalBytes)}) — disimpan bersama
                  pencatatan.
                </p>
              )}

              {willFail && (
                <div className="flex items-start gap-2 rounded-md border border-status-warning/50 bg-status-warning/10 px-3 py-3 text-navy-900">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-status-warning"
                    aria-hidden
                  />
                  <div className="text-sm">
                    <p className="font-medium">
                      Hasil ini akan menurunkan skor kepercayaan pemasok
                    </p>
                    <p className="text-muted-foreground">
                      {supplier ? (
                        <>
                          {supplier.name} ({supplier.id}) — skor sekarang{" "}
                          {supplier.reliabilityScore.toFixed(2)}. LEARN
                          (Skill.md §10) menyesuaikannya dari riwayat{" "}
                          <span className="font-mono">decisions.outcome</span>{" "}
                          berikutnya, dan itu ikut dinilai di keputusan selanjutnya.
                        </>
                      ) : (
                        "LEARN akan menyesuaikan skor pemasok kandidat terpilih dari riwayat outcome."
                      )}
                    </p>
                  </div>
                </div>
              )}

              {error && (
                <p className="rounded-md bg-status-danger/10 px-3 py-2 text-sm text-navy-900">
                  {error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {confirmingFailure ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => void doSubmit()}
                      disabled={!canSubmit}
                    >
                      {submitting ? "Menyimpan…" : "Ya, catat sebagai gagal"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmingFailure(false)}
                      disabled={submitting}
                    >
                      Batal
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Konfirmasi kedua diminta karena hasil gagal mengubah skor
                      pemasok.
                    </span>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={() =>
                      willFail ? setConfirmingFailure(true) : void doSubmit()
                    }
                    disabled={!canSubmit}
                  >
                    <PackageCheck className="h-4 w-4" aria-hidden />
                    {submitting ? "Menyimpan…" : "Simpan penerimaan"}
                  </Button>
                )}
                {!tempValid && temp.trim() !== "" && (
                  <span className="text-xs text-navy-900">
                    Suhu harus berupa angka.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Konteks pengiriman</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!selected ? (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Pilih pengiriman dulu — konteksnya (pemasok, bukti, batas waktu)
              muncul di sini supaya pengecekan tidak dilakukan tanpa dasar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="decision" value={selected.status} />
                <Badge tone="neutral">
                  {commodityLabel(selected.commodityId, commodities)}
                </Badge>
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Rute</dt>
                  <dd className="text-navy-900">
                    {locationLabel(selected.sourceLocationId, locations)} →{" "}
                    {locationLabel(selected.targetLocationId, locations)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Kuantitas</dt>
                  <dd className="tabular-nums text-navy-900">
                    {formatKg(selected.quantityKg)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Pemasok kandidat terpilih
                  </dt>
                  <dd className="text-navy-900">
                    {winner?.supplierId ?? "-"}
                    {supplier && (
                      <span
                        className={cn(
                          "ml-2 tabular-nums",
                          supplier.reliabilityScore >= 0.85
                            ? "text-navy-900"
                            : "text-navy-900",
                        )}
                      >
                        · skor {supplier.reliabilityScore.toFixed(2)}
                      </span>
                    )}
                  </dd>
                </div>
                {selected.expiresAt && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Batas waktu</dt>
                    <dd className="text-navy-900">
                      {new Date(selected.expiresAt).toLocaleString("id-ID", {
                        timeZone: "Asia/Jakarta",
                      })}
                    </dd>
                  </div>
                )}
              </dl>
              {selected.evidenceItems && selected.evidenceItems.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">
                    Bukti yang sudah ada ({selected.evidenceItems.length})
                  </p>
                  <ul className="flex flex-col gap-1 text-sm text-navy-900">
                    {selected.evidenceItems.map((item, i) => (
                      <li key={item.id ?? i} className="flex items-start gap-2">
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                            item.isConsistent === false
                              ? "bg-status-danger"
                              : item.isConsistent
                                ? "bg-status-safe"
                                : "bg-status-warning",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="font-mono text-xs">{item.type}</span>{" "}
                          — {item.source}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link
                href={`/decisions/${selected.id}`}
                className="text-sm text-brand hover:underline"
              >
                Lihat detail keputusan →
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      {decisionsQuery.error && (
        <div className="lg:col-span-3">
          <ErrorState
            message={(decisionsQuery.error as Error).message}
            onRetry={() => void decisionsQuery.refetch()}
            retrying={decisionsQuery.isFetching}
          />
        </div>
      )}
    </div>
  );
}
