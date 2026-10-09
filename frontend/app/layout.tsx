import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth";
import { QueryProvider } from "@/contexts/query";
import { ToastProvider } from "@/components/ui/toast";
import { PwaRegister } from "@/components/ui/pwa-register";

/**
 * design.md §4: font Inter (fallback system-ui) — jelas terbaca di data-dense
 * dashboard. Weight 400 (body) & 600 (heading) sudah termasuk di variable font.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Base path aplikasi ("" di lokal, "/MealChainGuardian" di GitHub Pages).
// Metadata URL TIDAK otomatis diberi base path oleh Next (berbeda dari `next/link`),
// jadi manifest ditulis lengkap di sini.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "MealChain Guardian",
  description:
    "Dashboard guardian untuk kontinuitas pasokan pangan institusional",
  applicationName: "MealChain Guardian",
  manifest: `${BASE_PATH}/manifest.webmanifest`,
};

/**
 * themeColor tidak bisa lewat kelas Tailwind (metadata peramban), jadi nilainya
 * ditulis di sini dan WAJIB sama dengan token `brand` di docs/design.md §4.
 * Jangan menyalin hex ini ke komponen mana pun.
 */
export const viewport: Viewport = {
  themeColor: "#0969DA",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={inter.variable}>
      <body>
        <PwaRegister />
        {/* Toast di paling luar supaya halaman login pun bisa memberi umpan balik. */}
        <ToastProvider>
          <AuthProvider>
            <QueryProvider>{children}</QueryProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
