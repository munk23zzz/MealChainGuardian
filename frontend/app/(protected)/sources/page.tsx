"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  sourcesByConfidence,
} from "@/lib/sources";

/**
 * Halaman Sumber Data — setiap angka punya asal, dan yang lemah diberi label
 * apa adanya. Tidak ada entri yang difilter: kalau sumbernya hanya simulasi,
 * itu ditampilkan sebagai simulasi, bukan disembunyikan.
 */
export default function SourcesPage() {
  const groups = sourcesByConfidence();

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-fade-up flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-navy-900">Sumber Data</h1>
        <p className="max-w-2xl text-muted-foreground">
          Setiap angka di aplikasi ini punya asal yang bisa dilacak, dan sumber
          yang lemah diberi label apa adanya — termasuk saat asalnya hanya
          simulasi.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.confidence} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-navy-900">{group.label}</h2>
            <span className="text-sm text-muted-foreground">
              {group.items.length} sumber
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.items.map((entry) => (
              <article
                key={entry.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
              >
                <p className="text-sm text-muted-foreground">{entry.label}</p>
                <p className="font-semibold text-navy-900">{entry.value}</p>
                {entry.note && (
                  <p className="text-xs text-muted-foreground">{entry.note}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <Badge tone={CONFIDENCE_TONES[entry.confidence]}>
                    {CONFIDENCE_LABELS[entry.confidence]}
                  </Badge>
                  {entry.url && (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="tap-target items-center gap-1 text-brand hover:underline"
                    >
                      Buka sumber
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
