import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CONFIDENCE_LABELS, CONFIDENCE_TONES, sourceById } from "@/lib/sources";

/**
 * Chip asal angka — menempelkan sumber pada nilai yang ditampilkan.
 * Keterangan lengkap (nilai + catatan + tautan) ditampilkan lewat `title`
 * supaya tidak memenuhi layar, tetapi tetap bisa diverifikasi.
 */
export function SourceChip({ id, className }: { id: string; className?: string }) {
  const source = sourceById(id);
  if (!source) return null;

  const tooltip = [
    `${source.label}: ${source.value}`,
    source.note,
    source.url,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Badge
      tone={CONFIDENCE_TONES[source.confidence]}
      className={cn("cursor-help font-normal", className)}
      title={tooltip}
    >
      {CONFIDENCE_LABELS[source.confidence]}
    </Badge>
  );
}
