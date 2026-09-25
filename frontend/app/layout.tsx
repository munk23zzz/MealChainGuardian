import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth";
import { QueryProvider } from "@/contexts/query";

/**
 * design.md §4: font Inter (fallback system-ui) — jelas terbaca di data-dense
 * dashboard. Weight 400 (body) & 600 (heading) sudah termasuk di variable font.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MealChain Guardian",
  description:
    "Dashboard guardian untuk kontinuitas pasokan pangan institusional",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={inter.variable}>
      <body>
        <AuthProvider>
          <QueryProvider>{children}</QueryProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
