import { Badge } from "@/components/ui/badge";
import type { ModelSource } from "@/lib/agent-log";

/**
 * Chip sumber model untuk step AI (design.md §3.4b — WAJIB terlihat, jangan
 * disembunyikan): `primary` netral, `fallback_1`/`fallback_2` kuning dengan
 * keterangan "provider cadangan dipakai".
 *
 * Transparansi ini bagian dari cerita reliability ke juri: kalau provider utama
 * sedang bermasalah, trace-nya menunjukkan langkah mana yang pindah ke cadangan.
 *
 * Return null untuk tool yang bukan panggilan model AI (tidak ada suffix) —
 * jangan menampilkan chip "primary" palsu di tool deterministik.
 */
export function ModelSourceChip({ source }: { source?: ModelSource }) {
  if (!source) return null;

  if (source === "primary") {
    return (
      <Badge tone="neutral" title="Provider utama dipakai">
        primary
      </Badge>
    );
  }

  return (
    <Badge
      tone="warning"
      title="Provider cadangan dipakai — provider utama gagal/lewat batas waktu"
    >
      {source} · cadangan
    </Badge>
  );
}
