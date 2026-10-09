"use client";

/**
 * Pendaftaran service worker.
 *
 * Hanya dijalankan pada build produksi: di mode pengembangan, cache SW justru
 * membuat aset lama tersaji terus (dan kita sudah pernah kejap dengan CSS basi).
 */

import { useEffect } from "react";

// Service worker disajikan relatif terhadap base path (Pages: /MealChainGuardian/sw.js).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => {
        /* offline tetap jadi bonus, bukan syarat aplikasi jalan */
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
