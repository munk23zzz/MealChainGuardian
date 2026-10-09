import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface MetricItem {
  label: string;
  value: string;
  /** Keterangan kecil di bawah nilai (mis. periode pembanding). */
  hint?: string;
  /**
   * Nada hanya muncul sebagai titik penanda di samping label, BUKAN sebagai
   * warna teks: kuning #F9A825 di atas putih tidak terbaca (kontras ~1,9:1),
   * sedangkan nilai tetap navy-900 yang selalu terbaca.
   */
  tone?: "safe" | "warning" | "danger" | "neutral";
}

const TONE_DOT: Record<NonNullable<MetricItem["tone"]>, string> = {
  safe: "bg-status-safe",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
  neutral: "bg-grey-500/60",
};

/**
 * MetricStrip — deretan angka kunci dalam satu kartu (design.md §3.6 pola kartu KPI,
 * dipakai juga di header keputusan & dashboard).
 *
 * Aturan tampilan: satu nilai besar per metrik, angka tabular (sejajar antar baris),
 * label kecil di atas, keterangan di bawah. Nilai yang tidak diketahui ditulis "-"
 * oleh pemanggil — komponen ini tidak pernah mengarang angka.
 */
export function MetricStrip({
  items,
  className,
}: {
  items: MetricItem[];
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {item.tone && (
                <span
                  aria-hidden
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    TONE_DOT[item.tone],
                  )}
                />
              )}
              <span className="truncate">{item.label}</span>
            </p>
            <p
              className="mt-0.5 truncate text-lg font-semibold tabular-nums text-navy-900"
              title={item.value}
            >
              {item.value}
            </p>
            {item.hint && (
              // Di bawah `sm` petunjuk dibiarkan membungkus penuh: tooltip `title` tidak ada
              // artinya di layar sentuh, jadi teksnya tidak boleh dipotong di ponsel
              // (skill UI/UX, aturan "Compact Label Overflow": jangan pakai hover-only tooltip).
              <p className="text-xs text-muted-foreground sm:truncate" title={item.hint}>
                {item.hint}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
