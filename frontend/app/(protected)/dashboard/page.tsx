"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { MapView } from "@/components/map/map-view";
import { SupplyDemandChart } from "@/components/charts/supply-demand-chart";
import { LocationCard } from "@/components/locations/location-card";
import { RecommendationCard } from "@/components/decisions/recommendation-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard, SkeletonRows } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  useCommodities,
  useDecisions,
  useLocations,
  useSupply,
} from "@/hooks/use-data";
import { useAuth } from "@/contexts/auth";
import { deriveLocationStatus } from "@/lib/status";
import { locationStatusLabel } from "@/lib/design-tokens";
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
  const { role, locationId } = useAuth();
  const locationsQuery = useLocations();
  const commoditiesQuery = useCommodities();
  const supplyQuery = useSupply();
  const decisionsQuery = useDecisions();

  const [commodityFilter, setCommodityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | LocationStatus>("all");

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

  const visibleLocations = useMemo(() => {
    const filtered =
      statusFilter === "all"
        ? locationsWithStatus
        : locationsWithStatus.filter((l) => l.status === statusFilter);

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
  }, [locationsWithStatus, statusFilter, role, locationId]);

  const criticalLocations = locationsWithStatus.filter(
    (l) => l.status === "critical",
  );

  const feedPreview = useMemo(
    () =>
      sortRecommendationsByUrgency(
        decisions.filter(
          (d) =>
            d.status === "pending_approval" || d.status === "verifier_flagged",
        ),
      ).slice(0, 3),
    [decisions],
  );

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
      <div>
        <h1 className="text-xl font-semibold text-navy-900">Dashboard</h1>
        <p className="text-muted-foreground">
          {isSppgStaff
            ? `Peta diarahkan ke lokasi Anda: ${locationLabel(locationId!, locations)}. Lokasi lain ditampilkan redup.`
            : "Peta 10 lokasi SPPG: hijau normal, kuning tight, merah kritis."}
        </p>
      </div>

      {error && (
        <ErrorState
          message={(error as Error).message}
          onRetry={retryAll}
          retrying={locationsQuery.isFetching}
        />
      )}

      {criticalLocations.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-status-danger/40 bg-status-danger/10 px-4 py-3 text-status-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>{criticalLocations.length} lokasi kritis</strong> —{" "}
            {criticalLocations.map((l) => l.name).join(", ")}. Cek rekomendasi
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
        <div className="h-[420px] overflow-hidden rounded-lg border border-border bg-card lg:col-span-2">
          {isLoading ? (
            <SkeletonRows rows={5} className="p-4" />
          ) : (
            <MapView
              locations={locationsWithStatus}
              summaries={locationsWithStatus.map((loc) => ({
                locationId: loc.id,
                lines: commodityLinesForLocation(loc.id, filteredSupply, commodities),
                worstStatus: null,
              }))}
              focusLocationId={isSppgStaff ? locationId : null}
            />
          )}
        </div>

        <Card className="h-[420px] overflow-hidden">
          <CardHeader>
            <CardTitle>Pasokan per lokasi</CardTitle>
          </CardHeader>
          <CardContent className="h-[340px] pt-0">
            <SupplyDemandChart
              supplies={filteredSupply}
              labelFor={(id) => shortLocationLabel(locationLabel(id, locations))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Grid lokasi (design.md §4 LocationCard) */}
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-navy-900">Status lokasi</h2>
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
                    filteredSupply,
                    commodities,
                  )}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Feed rekomendasi terbaru (urut urgensi) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-navy-900">Rekomendasi menunggu</h2>
          <a href="/decisions" className="text-navy-700 hover:underline">
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
      style={active ? { backgroundColor: "#0969DA", borderColor: "#0969DA", color: "#fff" } : undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "text-white"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
