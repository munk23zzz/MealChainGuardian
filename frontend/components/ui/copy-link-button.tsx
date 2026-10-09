"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * "Salin tautan" — aturan skill UI/UX `deep-linking`: tampilan yang bermakna harus bisa
 * dibagikan lewat URL. Yang disalin adalah URL halaman SAAT INI (sudah memuat parameter
 * pilihan, mis. `?pemasok=...` atau `?batch=...`), bukan URL yang dirakit ulang di sini —
 * supaya yang tersalin selalu sama dengan yang sedang dilihat.
 *
 * Aman untuk cakupan peran: parameter yang ikut di URL hanya PILIHAN di dalam data yang
 * sudah tersaring cakupan (`lib/view-params.ts`). Saklar "tampilkan semua wilayah" tidak
 * pernah masuk URL.
 */
export function CopyLinkButton({
  label = "Salin tautan",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback untuk konteks yang tidak mengizinkan Clipboard API.
        const area = document.createElement("textarea");
        area.value = url;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      push({
        title: "Tautan disalin",
        description: "Tautan ini membuka tampilan yang sama, termasuk pilihan yang sedang aktif.",
        tone: "success",
      });
    } catch {
      push({
        title: "Gagal menyalin tautan",
        description: `Salin manual dari bilah alamat: ${url}`,
        tone: "warning",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={className}
      aria-label={label}
    >
      {copied ? <Check aria-hidden /> : <Link2 aria-hidden />}
      {copied ? "Tersalin" : label}
    </Button>
  );
}
