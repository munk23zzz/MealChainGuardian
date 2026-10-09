"use client";

/**
 * Lapisan mode demo (?demo=1&step=N).
 *
 * Prinsip: mode demo TIDAK memalsukan data apa pun. Ia hanya (a) menampilkan
 * garis waktu skenario, (b) menyediakan tombol maju/mundur, dan (c) menyorot
 * bagian layar yang sedang dibicarakan. Kalau elemen sorotan tidak ada, lapisan
 * ini tetap berjalan tanpa error.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, CirclePlay, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_STEPS, parseDemoQuery, previousStep, nextStep } from "@/lib/demo";

export function DemoLayer() {
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Dibaca di klien (bukan useSearchParams) supaya aman dipakai di layout.
  useEffect(() => {
    const parsed = parseDemoQuery(window.location.search);
    setEnabled(parsed.enabled);
    setStep(parsed.step);
  }, [pathname]);

  const current = step === null ? null : (DEMO_STEPS[step] ?? null);

  // Sorot elemen yang relevan dengan langkah demo saat ini.
  useEffect(() => {
    if (!current || current.highlight === "none") return;
    const target = document.querySelector<HTMLElement>(
      `[data-demo="${current.highlight}"]`,
    );
    if (!target) return;
    target.classList.add("ring-2", "ring-brand", "ring-offset-2", "rounded-lg");
    return () => {
      target.classList.remove("ring-2", "ring-brand", "ring-offset-2", "rounded-lg");
    };
  }, [current, pathname]);

  if (!enabled || current === null || step === null) return null;

  const close = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    url.searchParams.delete("step");
    window.location.assign(url.toString());
  };

  return (
    <div
      role="region"
      aria-label="Mode demo"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy-700/30 bg-card/95 px-3 py-2 backdrop-blur sm:px-4"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-grey-500">
          <CirclePlay className="h-3.5 w-3.5" aria-hidden />
          Skenario demo · {current.clock}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-navy-900">{current.title}</p>
          <p className="truncate text-xs text-navy-700">
            {current.detail} · <span className="text-grey-500">{current.source}</span>
          </p>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-grey-500">
            Langkah {step + 1}/{DEMO_STEPS.length}
          </span>
          {previousStep(step) !== step && (
            <Button asChild size="sm" variant="outline">
              <Link href={`${DEMO_STEPS[previousStep(step)].href}?demo=1&step=${previousStep(step)}`}>
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                Mundur
              </Link>
            </Button>
          )}
          {nextStep(step) !== step ? (
            <Button asChild size="sm">
              <Link href={`${DEMO_STEPS[nextStep(step)].href}?demo=1&step=${nextStep(step)}`}>
                Lanjut
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">
                Selesai
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Keluar dari mode demo"
            onClick={close}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
