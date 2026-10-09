"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { MapView } from "@/components/map/map-view";
import { SupplyDemandChart } from "@/components/charts/supply-demand-chart";
import { LocationCard } from "@/components/locations/location-card";
import { RecommendationCard } from "@/components/decisions/recommendation-card";
import { AttentionList } from "@/components/dashboard/attention-list";
import { KpiSummary } from "@/components/dashboard/kpi-summary";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricStrip } from "@/components/ui/metric-strip";
import {
  useCommodities,
  useDecisions,
  useKpi,
  useLocations,
  useSupply,
  useDemand,
} from "@/hooks/use-data";
import { useAuth } from "@/contexts/auth";
import { deriveLocationStatus } from "@/lib/status";
import { locationStatusLabel } from "@/lib/design-tokens";
import { expiryState } from "@/lib/expiry";
import { formatDateTime, formatPercent } from "@/lib/format";
import { isGlobalRole, scopeForRole } from "@/lib/role";
import {
  decisionTouchesScope,
  isLocationInScope,
  partitionByScope,
  scopeDescription,
  scopeLabel,
} from "@/lib/scope";
import {
  commodityLinesForLocation,
  commodityLabel,
  locationLabel,
  shortLocationLabel,
} from "@/lib/labels";
import { sortRecommendationsByUrgency } from "@/lib/urgency";
import { cn } from "@/lib/utils";
import type { Location, LocationStatus, SupplyRecord } from "@/lib/api/schema";

const STATUS_FILTERS: { value: "all" | LocationStatus; label: string }[] = [
  { value: "all", label: "Semua status" },
  { value: "ok", label: locationStatusLabel("ok") },
  { value: "warning", label: locationStatusLabel("warning") },
  { value: "critical", label: locationStatusLabel("critical") },
];

export default function DashboardPage() {
  const { role, region, locationId, canApprove } = useAuth();
  const locationsQuery = useLocations();
  const commoditiesQuery = useCommodities();
  const supplyQuery = useSupply();
  const demandQuery = useDemand();
  const decisionsQuery = useDecisions();
  const kpiQuery = useKpi();

  const [commodityFilter, setCommodityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | LocationStatus>("all");
  /** Bawaan: cakupan peran saja. User boleh membuka semua wilayah sendiri. */
  const [showAllScopes, setShowAllScopes] = useState(false);

  // Data query di-memo agar referensinya stabil (menghindari useMemo di bawah
  // dihitung ulang tiap render).
  const locations: Location[] = useMemo(
    () => locationsQuery.data ?? [],
    [locationsQuery.data],
  );
  const commodities = useMemo(
    () => commoditiesQuery.data ?? [],
    [commoditiesQuery.data],
  );
  const supply: SupplyRecord[] = useMemo(
    () => supplyQuery.data ?? [],
    [supplyQuery.data],
  );
  const demand = useMemo(() => demandQuery.data ?? [], [demandQuery.data]);
  const decisions = useMemo(
    () => decisionsQuery.data ?? [],
    [decisionsQuery.data],
  );

  const error =
    locationsQuery.error ||
    commoditiesQuery.error ||
    supplyQuery.error ||
    decisionsQuery.error;
  const isLoading =
    locationsQuery.isPending || supplyQuery.isPending || decisionsQuery.isPending;

  const retryAll = () => {
    void locationsQuery.refetch();
    void supplyQuery.refetch();
    void decisionsQuery.refetch();
  };

  // Filter komoditas memengaruhi status tiap lokasi (status = kondisi komoditas
  // yang sedang dilihat), bukan cuma daftar isinya.
  const filteredSupply = useMemo(
    () =>
      commodityFilter === "all"
        ? supply
        : supply.filter((s) => s.commodityId === commodityFilter),
    [supply, commodityFilter],
  );

  const locationsWithStatus: Location[] = useMemo(
    () =>
      locations.map((loc) => ({
        ...loc,
        status: deriveLocationStatus(
          filteredSupply.filter((s) => s.locationId === loc.id),
        ),
      })),
    [locations, filteredSupply],
  );

  // ---------------------------------------------------------------------------
  // Batasan peran (design.md §1.4 "role-aware by default")
  // kepala/ahli gizi SPPG → wilayahnya; monitor BGN → semua wilayah (read-only).
  // ---------------------------------------------------------------------------
  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const effectiveScope = useMemo(
    () => (showAllScopes ? ({ kind: "all" } as const) : roleScope),
    [showAllScopes, roleScope],
  );
  const isScoped = roleScope.kind !== "all";
  /** Menampilkan seluruh wilayah — entah karena peran global atau tombol dibuka. */
  const showingAll = effectiveScope.kind === "all";
  const isGlobal = isGlobalRole(role);

  /** Lokasi yang boleh dilihat peran ini (dasar untuk SEMUA blok di bawah). */
  const scopedLocations = useMemo(
    () =>
      locationsWithStatus.filter((l) =>
        isLocationInScope(l.id, effectiveScope, locations),
      ),
    [locationsWithStatus, effectiveScope, locations],
  );
  const scopedIds = useMemo(
    () => new Set(scopedLocations.map((l) => l.id)),
    [scopedLocations],
  );
  const scopedSupply = useMemo(
    () => filteredSupply.filter((s) => scopedIds.has(s.locationId)),
    [filteredSupply, scopedIds],
  );
  /** Keputusan di luar cakupan tidak dibuang diam-diam — jumlahnya disebut di UI. */
  const { inScope: scopedDecisions, outOfScope: outsideDecisions } = useMemo(
    () =>
      partitionByScope(decisions, (d) =>
        decisionTouchesScope(d, effectiveScope, locations),
      ),
    [decisions, effectiveScope, locations],
  );

  const visibleLocations = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? scopedLocations
        : scopedLocations.filter((l) => l.status === statusFilter);

    // Role-aware (design.md §1.4): lokasi sendiri tampil paling depan untuk
    // SPPG staff, sisanya menyusul.
    if (role === "sppg_staff" && locationId) {
      return [...filtered].sort((a, b) => {
        if (a.id === locationId) return -1;
        if (b.id === locationId) return 1;
        return 0;
      });
    }
    return filtered;
  }, [scopedLocations, statusFilter, role, locationId]);

  const criticalLocations = scopedLocations.filter(
    (l) => l.status === "critical",
  );

  /**
   * Keputusan yang benar-benar menunggu tindakan manusia. `verifier_flagged` DAN
   * `verifier_unavailable` sama-sama butuh 2 approval (Schema.md §6), jadi
   * keduanya masuk hitungan — bukan cuma yang statusnya pending.
   */
  const actionable = useMemo(
    () =>
      scopedDecisions.filter(
        (d) =>
          d.status === "pending_approval" ||
          d.status === "verifier_flagged" ||
          d.status === "verifier_unavailable",
      ),
    [scopedDecisions],
  );

  const feedPreview = useMemo(
    () => sortRecommendationsByUrgency(actionable).slice(0, 3),
    [actionable],
  );

  /** Batas waktunya sudah mendesak/kritis — bagian "kapan", bukan cuma "apa". */
  const urgentCount = actionable.filter((d) => {
    const state = expiryState(d.expiresAt);
    return state === "warning" || state === "critical";
  }).length;

  const kpi = kpiQuery.data;
  const lastUpdated = locationsQuery.dataUpdatedAt;

  const isSppgStaff = role === "sppg_staff" && Boolean(locationId);

  const commodityOptions = useMemo(
    () => [
      { id: "all", label: "Semua" },
      ...commodities.map((c) => ({
        id: c.id,
        label: commodityLabel(c.id, commodities),
      })),
    ],
    [commodities],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Dashboard</h1>
          <p className="text-muted-foreground">
            {isSppgStaff
              ? `Peta diarahkan ke lokasi Anda: ${locationLabel(locationId!, locations)}. Lokasi lain ditampilkan redup.`
              : showingAll
                ? `Semua wilayah · ${scopedLocations.length} lokasi SPPG dipantau (hijau normal, kuning tight, merah kritis).`
                : `Wilayah Anda: ${scopeLabel(roleScope)} · ${scopedLocations.length} lokasi SPPG (hijau normal, kuning tight, merah kritis).`}
          </p>
        </div>
        {lastUpdated > 0 && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {locationsQuery.isFetching ? "memperbarui…" : "terakhir diperbarui"}{" "}
            {formatDateTime(new Date(lastUpdated).toISOString())}
          </span>
        )}
      </div>

      {/* Batasan peran: apa yang ditampilkan & apa yang boleh dilakukan (design.md §1.4) */}
      <div className="animate-fade-up flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-navy-900">
          <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>
            {scopeDescription(effectiveScope, outsideDecisions.length)} ·{" "}
            {scopedLocations.length} lokasi
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!canApprove && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-navy-900">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Read-only — tanpa hak approve
            </span>
          )}
          {isScoped && (
            <button
              type="button"
              onClick={() => setShowAllScopes((v) => !v)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-navy-900 transition-colors hover:border-navy-700/30"
            >
              {showAllScopes
                ? `Batasi ke ${scopeLabel(roleScope)}`
                : "Tampilkan semua wilayah"}
            </button>
          )}
        </div>
      </div>

      {/* Strip operasional: yang perlu ditindak SEKARANG (bukan KPI bulanan). */}
      <MetricStrip
        className="animate-fade-up"
        items={[
          {
            label: "Lokasi kritis",
            value: String(criticalLocations.length),
            hint: `dari ${scopedLocations.length} lokasi ${showingAll ? "dipantau" : "di cakupan Anda"}`,
            tone: criticalLocations.length > 0 ? "danger" : "safe",
          },
          {
            label: "Keputusan menunggu",
            value: String(actionable.length),
            hint: "butuh approval manusia",
            tone: actionable.length > 0 ? "warning" : "safe",
          },
          {
            label: "Batas waktu mendesak",
            value: String(urgentCount),
            hint: "sisa kurang dari 2 jam",
            tone: urgentCount > 0 ? "warning" : "safe",
          },
          {
            label: "Kelengkapan bukti",
            value: kpi ? formatPercent(kpi.evidenceCompletenessPercent) : "—",
            hint: "rata-rata semua keputusan",
            tone: "neutral",
          },
        ]}
      />

      {error && (
        <ErrorState
          message={(error as Error).message}
          onRetry={retryAll}
          retrying={locationsQuery.isFetching}
        />
      )}

      {criticalLocations.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-navy-900">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-status-danger"
            aria-hidden
          />
          <p>
            <strong className="text-status-danger">
              {criticalLocations.length} lokasi kritis
            </strong>{" "}
            — {criticalLocations.map((l) => l.name).join(", ")}. Cek rekomendasi
            agent untuk alokasi ulang.
          </p>
        </div>
      )}

      {/* Filter (design.md §3.1: sidebar filter komoditas + status) */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-muted-foreground">Komoditas:</span>
            {commodityOptions.map((c) => (
              <FilterButton
                key={c.id}
                active={commodityFilter === c.id}
                onClick={() => setCommodityFilter(c.id)}
              >
                {c.label}
              </FilterButton>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-muted-foreground">Status:</span>
            {STATUS_FILTERS.map((s) => (
              <FilterButton
                key={s.value}
                active={statusFilter === s.value}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </FilterButton>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="relative h-[420px] overflow-hidden rounded-lg border border-border bg-card lg:col-span-2">
          {isLoading ? (
            <SkeletonRows rows={5} className="p-4" />
          ) : (
            <MapView
              locations={scopedLocations}
              summaries={scopedLocations.map((loc) => ({
                locationId: loc.id,
                lines: commodityLinesForLocation(loc.id, scopedSupply, commodities),
                worstStatus: null,
              }))}
              focusLocationId={isSppgStaff ? locationId : null}
            />
          )}
          {/* Legenda warna status: warna peta tidak boleh harus ditebak. */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-navy-900 shadow-sm backdrop-blur">
            <span className="font-medium">Status lokasi:</span>
            {(
              [
                ["ok", "bg-status-safe"],
                ["warning", "bg-status-warning"],
                ["critical", "bg-status-danger"],
              ] as const
            ).map(([status, dot]) => (
              <span key={status} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("inline-block h-2 w-2 rounded-full", dot)}
                />
                {locationStatusLabel(status)}
              </span>
            ))}
          </div>
        </div>

        <Card className="h-[420px] overflow-hidden">
          <CardHeader>
            <CardTitle>Pasokan per lokasi</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px] pt-0">
            <SupplyDemandChart
              supplies={scopedSupply}
              demands={demand}
              labelFor={(id) => shortLocationLabel(locationLabel(id, locations))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Grid lokasi (design.md §4 LocationCard) */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-navy-900">
          {showingAll ? "Status lokasi" : `Status lokasi — ${scopeLabel(roleScope)}`}
        </h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : visibleLocations.length === 0 ? (
          <EmptyState
            title="Tidak ada lokasi yang cocok dengan filter"
            description="Coba ganti filter komoditas atau status — semua lokasi sedang tersaring keluar."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleLocations.map((loc) => (
              <div
                key={loc.id}
                className={cn(
                  isSppgStaff && loc.id !== locationId && "opacity-60",
                )}
              >
                <LocationCard
                  location={loc}
                  commodities={commodityLinesForLocation(
                    loc.id,
                    scopedSupply,
                    commodities,
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Blok khusus peran lintas wilayah (design.md §2): KPI global + drill-down */}
      {isGlobal && <KpiSummary />}
      <AttentionList locations={scopedLocations} />

      {/* Feed rekomendasi terbaru (urut urgensi) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-navy-900">Rekomendasi menunggu</h2>
          <a href="/decisions" className="text-brand hover:underline">
            Lihat semua
          </a>
        </div>
        {isLoading ? (
          <SkeletonRows rows={2} />
        ) : feedPreview.length === 0 ? (
          <EmptyState
            title="Belum ada rekomendasi aktif"
            description="Agent belum menemukan ketidakseimbangan yang butuh keputusan. Feed akan terisi saat ada defisit/surplus baru."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {feedPreview.map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                locationLabel={(id) => locationLabel(id, locations)}
                commodityLabel={(id) => commodityLabel(id, commodities)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
