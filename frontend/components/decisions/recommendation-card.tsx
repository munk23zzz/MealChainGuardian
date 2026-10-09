import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge, ToneBadge } from "@/components/status/status-badge";
import { formatDateTime, formatKg } from "@/lib/format";
import { urgencyLabel, urgencyTier } from "@/lib/urgency";
import type { Recommendation } from "@/lib/api/schema";

const URGENCY_TONE = ["danger", "warning", "info"] as const;

/**
 * RecommendationCard (design.md §3.2): item feed — judul singkat, badge status,
 * waktu, tombol "Lihat Detail", dan penanda urgensi (safety issue dulu).
 */
export function RecommendationCard({
  recommendation,
  locationLabel = (id) => id,
  commodityLabel = (id) => id,
}: {
  recommendation: Recommendation;
  locationLabel?: (id: string) => string;
  commodityLabel?: (id: string) => string;
}) {
  const tier = urgencyTier(recommendation);
  const source = locationLabel(recommendation.sourceLocationId);
  const target = locationLabel(recommendation.targetLocationId);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <p className="font-semibold text-navy-900">
            Alokasi {source} <ArrowRight className="inline h-3.5 w-3.5" /> {target}{" "}
            direkomendasikan
          </p>
          <p className="mt-1 text-muted-foreground">
            {commodityLabel(recommendation.commodityId)} ·{" "}
            {formatKg(recommendation.quantityKg)} ·{" "}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(recommendation.createdAt)}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge kind="decision" value={recommendation.status} />
          <StatusBadge kind="safety" value={recommendation.safetyCheck} />
        </div>
      </CardHeader>

      <CardContent className="pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={URGENCY_TONE[tier]}>{urgencyLabel(recommendation)}</ToneBadge>
          <ToneBadge tone="outline">
            Kelengkapan bukti {recommendation.evidence.completenessPercent}%
          </ToneBadge>
          <Link
            href={`/decisions/${recommendation.id}`}
            className="tap-target ml-auto font-medium text-navy-700 hover:underline"
          >
            Lihat detail
          </Link>
        </div>
        {recommendation.reason && (
          <p className="mt-3 line-clamp-2 text-muted-foreground">
            {recommendation.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
