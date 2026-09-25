import Link from "next/link";
import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status/status-badge";
import { formatKg } from "@/lib/format";
import type { Location, SupplyRecord } from "@/lib/api/schema";

export interface LocationCommodityLine {
  commodityId: string;
  label: string;
  status: SupplyRecord["status"];
  usableStockKg: number;
}

/**
 * LocationCard (design.md §4): ringkasan status satu lokasi.
 * Dipakai di grid dashboard; membawa status agregat + ringkas per komoditas.
 */
export function LocationCard({
  location,
  commodities = [],
}: {
  location: Location;
  commodities?: LocationCommodityLine[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">
            <Link href={`/dashboard?location=${location.id}`} className="hover:underline">
              {location.name}
            </Link>
          </CardTitle>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}
          </p>
        </div>
        <StatusBadge kind="location" value={location.status} />
      </CardHeader>

      <CardContent className="pt-3">
        {commodities.length === 0 ? (
          <p className="text-muted-foreground">
            Belum ada data pasokan untuk lokasi ini.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {commodities.map((c) => (
              <li
                key={c.commodityId}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{c.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground">
                    {formatKg(c.usableStockKg)}
                  </span>
                  <StatusBadge kind="supply" value={c.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
