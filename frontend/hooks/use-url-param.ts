"use client";

import { useCallback, useEffect, useState } from "react";
import { setQueryParam } from "@/lib/view-params";

/**
 * Parameter URL yang bisa dibaca/diubah dari komponen klien — untuk menautkan TAMPILAN
 * (batch terpilih, panel pemasok) supaya bisa dibagikan dan pulih setelah kembali
 * (aturan skill `deep-linking` + `state-preservation`).
 *
 * Sengaja TIDAK memakai `useSearchParams()` dari next/navigation: aplikasi ini diekspor
 * statis (GitHub Pages), dan hook itu memaksa halaman jadi klien penuh / butuh Suspense.
 * Membaca `window.location` di dalam efek sama amannya di ekspor statis, dan `popstate`
 * membuat tombol back tetap bekerja.
 *
 * Perubahan URL memakai `history.replaceState`, bukan `pushState`: membuka-menutup panel
 * berulang kali tidak boleh menumpuk riwayat (aturan `back-behavior` — back harus berarti
 * "keluar dari halaman ini", bukan "mundur satu panel").
 */
export function useUrlParam(key: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      setValue(params.get(key));
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [key]);

  const update = useCallback(
    (next: string | null) => {
      if (typeof window === "undefined") return;
      const search = setQueryParam(window.location.search, key, next);
      window.history.replaceState(null, "", `${window.location.pathname}${search}`);
      setValue(next === "" ? null : next);
    },
    [key],
  );

  return [value, update];
}
