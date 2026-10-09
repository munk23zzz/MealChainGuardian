import type { MetadataRoute } from "next";

/**
 * Manifest PWA — supaya aplikasi bisa dipasang di ponsel dapur SPPG dan dipakai
 * seperti aplikasi biasa (bukan bookmark peramban).
 * Warna di sini adalah cermin token docs/design.md §4 dan tidak dipakai di
 * komponen mana pun.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MealChain Guardian",
    short_name: "MealChain",
    description:
      "Guardian rantai pasok pangan institusional: keamanan pangan, keputusan, dan bukti audit.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    lang: "id",
    background_color: "#F5F6FA",
    theme_color: "#0969DA",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
