"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { getRedirectForAuthState } from "@/lib/routes";
import { Sidebar } from "@/components/sidebar/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { SidebarProvider } from "@/contexts/sidebar";
import { SkeletonRows } from "@/components/ui/skeleton";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { CommandPalette } from "@/components/layout/command-palette";
import { DemoLayer } from "@/components/demo/demo-layer";

/**
 * Layout halaman terlindungi.
 *
 * Catatan penting: keputusan redirect menunggu `status` dari AuthProvider selesai
 * "loading" (token dibaca setelah mount). Kalau tidak, refresh halaman apa pun
 * akan langsung terlempar ke /login walaupun token masih valid.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const redirect = getRedirectForAuthState(status, pathname);
    if (redirect) {
      router.replace(redirect);
    }
  }, [status, pathname, router]);

  if (status === "loading") {
    return (
      <div className="p-6">
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <a
            href="#konten"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:text-navy-900 focus:shadow"
          >
            Lompat ke konten utama
          </a>
          <TopBar />
          <OfflineBanner />
          {/* pb ekstra: memberi ruang untuk bilah mode demo dan tombol aksi lapangan. */}
          <main id="konten" className="flex-1 p-4 pb-28 sm:p-6 sm:pb-24">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette />
      <DemoLayer />
    </SidebarProvider>
  );
}
