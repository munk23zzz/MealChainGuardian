"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth";
import { getRedirectForAuthState } from "@/lib/routes";
import { Sidebar } from "@/components/sidebar/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { SidebarProvider } from "@/contexts/sidebar";
import { SkeletonRows } from "@/components/ui/skeleton";

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
          <TopBar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
