"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import type { Location } from "@/lib/api/schema";

/**
 * Titik masuk drill-down untuk peran lintas wilayah (design.md §2: "drill-down ke
 * lokasi bermasalah"). Urutan: kritis dulu, lalu tight.
 */
export function AttentionList({
  locations,
  limit = 5,
}: {
  locations: Location[];
  limit?: number;
}) {
  const rows = [...locations]
    .filter((l) => l.status === "critical" || l.status === "warning")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "critical" ? -1 : 1))
    .slice(0, limit);

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle>Lokasi perlu perhatian</CardTitle>
        <p className="text-muted-foreground">
          Diurutkan dari yang paling mendesak; klik untuk melihat keputusan yang
          menyentuh lokasi itu.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            title="Tidak ada lokasi bermasalah"
            description="Semua lokasi dalam kondisi normal pada filter yang sedang aktif."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((location) => (
              <li
                key={location.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/40"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusBadge kind="location" value={location.status} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-navy-900">
                      {location.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {location.region}
                    </span>
                  </span>
                </span>
                <Link
                  href={`/decisions?location=${location.id}`}
                  className="inline-flex min-h-11 shrink-0 items-center text-sm text-brand hover:underline sm:min-h-0"
                >
                  Lihat keputusan →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
