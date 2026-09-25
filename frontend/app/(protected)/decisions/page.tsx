"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RecommendationCard } from "@/components/decisions/recommendation-card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  useCommodities,
  useDecisions,
  useLocations,
} from "@/hooks/use-data";
import {
  commodityLabel,
  locationLabel,
  recommendationsForLocation,
} from "@/lib/labels";
import { sortRecommendationsByUrgency } from "@/lib/urgency";
import { decisionStatusLabel } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";
import type { DecisionStatus } from "@/lib/api/schema";

const STATUS_FILTERS: { value: "all" | DecisionStatus; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "proposed", label: decisionStatusLabel("proposed") },
  { value: "verifier_flagged", label: decisionStatusLabel("verifier_flagged") },
  { value: "pending_approval", label: decisionStatusLabel("pending_approval") },
  { value: "approved", label: decisionStatusLabel("approved") },
  { value: "rejected", label: decisionStatusLabel("rejected") },
  { value: "executed", label: decisionStatusLabel("executed") },
];

/**
 * Recommendation Feed (design.md §3.2).
 *
 * List card, diurutkan berdasarkan urgensi (safety issue > regional imbalance >
 * price anomaly), bukan semata-mata yang terbaru.
 *
 * `useSearchParams` dipakai untuk filter lokasi dari peta; dibungkus Suspense
 * supaya halaman ini tetap bisa di-prerender (Next 14).
 */
export default function DecisionsPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <DecisionsPageInner />
    </Suspense>
  );
}

function DecisionsPageInner() {
  const searchParams = useSearchParams();
  const locationFilter = searchParams.get("location");

  const { data, error, isPending, isFetching, refetch } = useDecisions({
    demo: true,
  });
  const locationsQuery = useLocations();
  const commoditiesQuery = useCommodities();
  const [statusFilter, setStatusFilter] = useState<"all" | DecisionStatus>("all");

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const commodities = useMemo(
    () => commoditiesQuery.data ?? [],
    [commoditiesQuery.data],
  );
  const decisions = useMemo(() => data ?? [], [data]);

  const visible = useMemo(() => {
    const byLocation = locationFilter
      ? recommendationsForLocation(decisions, locationFilter)
      : decisions;
    const byStatus =
      statusFilter === "all"
        ? byLocation
        : byLocation.filter((d) => d.status === statusFilter);
    return sortRecommendationsByUrgency(byStatus);
  }, [decisions, locationFilter, statusFilter]);

  const counts = useMemo(
    () => ({
      pending: decisions.filter(
        (d) => d.status === "pending_approval" || d.status === "verifier_flagged",
      ).length,
      flagged: decisions.filter((d) => d.verifierNote).length,
      executed: decisions.filter((d) => d.status === "executed").length,
    }),
    [decisions],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">
            Rekomendasi keputusan
          </h1>
          <p className="text-muted-foreground">
            Urutan berdasarkan urgensi: isu keamanan lebih dulu, lalu
            ketidakseimbangan regional, terakhir anomali harga.
          </p>
        </div>
        <p className="text-muted-foreground">
          {counts.pending} menunggu keputusan · {counts.flagged} ber-flag Verifier ·{" "}
          {counts.executed} dieksekusi
          {isFetching && <span className="ml-2">· memperbarui…</span>}
        </p>
      </div>

      {error && (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      )}

      {locationFilter && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p>
              Difilter ke lokasi:{" "}
              <strong className="text-navy-900">
                {locationLabel(locationFilter, locations)}
              </strong>
            </p>
            <a href="/decisions" className="text-navy-700 hover:underline">
              Tampilkan semua lokasi
            </a>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            style={statusFilter === s.value ? { backgroundColor: "#0969DA", borderColor: "#0969DA", color: "#fff" } : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              statusFilter === s.value
                ? "text-white"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="Belum ada rekomendasi aktif"
          description={
            statusFilter === "all"
              ? "Agent belum menemukan ketidakseimbangan pasokan yang butuh keputusan. Feed akan terisi otomatis saat ada defisit atau surplus baru."
              : "Tidak ada rekomendasi dengan status ini. Coba pilih status lain atau kembali ke Semua."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((rec) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              locationLabel={(id) => locationLabel(id, locations)}
              commodityLabel={(id) => commodityLabel(id, commodities)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
