"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logoMark from "@/assets/logo-mark.png";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/contexts/sidebar";
import { useAuth } from "@/contexts/auth";
import { isNavActive, visibleNavItems } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/role";
import {
  LayoutDashboard,
  Home,
  ClipboardList,
  ShieldCheck,
  Recycle,
  Truck,
  ScrollText,
  Gauge,
  BarChart3,
  Database,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
} from "lucide-react";

/**
 * Ikon per tujuan navigasi. Daftar tujuan + pembatasan perannya ada di
 * `lib/nav.ts` (murni & teruji) supaya sidebar dan command palette tidak pernah
 * berbeda soal halaman apa yang boleh dilihat sebuah peran.
 */
const ICON_BY_HREF: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/today": Home,
  "/decisions": ClipboardList,
  "/compliance": ShieldCheck,
  "/surplus": Recycle,
  "/suppliers": Truck,
  "/agent-log": ScrollText,
  "/quality": Gauge,
  "/kpi": BarChart3,
  "/sources": Database,
};

/**
 * Aset logo rail: `assets/logo-mark.png` (96x96, sudah dipangkas ke batas alfanya).
 * SENGAJA diimpor sebagai modul, bukan ditulis sebagai URL string ke `public/`: Next
 * memberi URL ber-hash (`/_next/static/media/logo-mark.<hash>.png`) plus basePath, sehingga
 * begitu logo diganti, URL-nya ikut berubah dan cache browser/service worker tidak bisa
 * menyajikan artwork lama — dulu ini terjadi dan logo baru tidak sampai ke pengguna.
 * `logo.png` tetap ada di `public/img/` sebagai sumber/master (bukan untuk UI: 500x500
 * dengan margin kosong besar sehingga pada kotak 28px tandanya hanya ter-render ~13px).
 */

export function Sidebar() {
  const pathname = usePathname();
  const { isOpen, toggle } = useSidebar();
  const { user, role, logout } = useAuth();

  // Layar sempit: sidebar jadi laci yang tertutup default (dapur = ponsel).
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setIsMobile(query.matches);
      if (!query.matches) setMobileOpen(false);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const expanded = isMobile ? mobileOpen : isOpen;
  const closeOrToggle = () => (isMobile ? setMobileOpen(false) : toggle());

  // Inisial dari nama user, fallback ke role
  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (role ?? "?").slice(0, 2).toUpperCase();

  const displayName = user?.name || role || "-";
  const displayRole = role ? ROLE_LABELS[role] : "-";

  return (
    <>
      {/* Latar gelap saat laci terbuka di ponsel */}
      {isMobile && mobileOpen && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-navy-900/40 md:hidden"
        />
      )}

      {/* Tombol buka laci saat sidebar tergeser keluar */}
      {isMobile && !mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu"
          className="fixed bottom-4 left-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      )}

      <aside
        className={cn(
          "flex shrink-0 flex-col overflow-hidden bg-brand text-white transition-all duration-300 ease-in-out",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-50 w-64 shadow-xl",
                !mobileOpen && "-translate-x-full",
              )
            : cn("sticky top-0 h-screen", isOpen ? "w-64" : "w-16"),
        )}
      >
        {/* Logo / Brand — di rail yang tertutup, logo itu sendiri adalah tombol pembuka. */}
        <div className="flex items-center gap-2 px-3 py-4 shrink-0">
          {expanded ? (
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center select-none">
              {/* Dekoratif: nama brand tertulis tepat di sebelahnya.
                  TANPA tile putih (permintaan Roy, 10 Okt): mark transparan langsung di atas
                  biru rail. Catatan terukur: mark di atas `brand #0969DA` hanya 1,12-2,57:1
                  (di bawah ambang 3:1 untuk grafik bermakna), jadi keterbacaannya memang
                  turun. Ini disengaja dan aman karena mark-nya dekoratif (alt="" + aria-hidden)
                  sementara namanya tertulis sebagai teks di sebelah kanan. Kalau nanti terasa
                  terlalu samar, kembalikan `bg-white rounded-lg` di div ini. */}
              <Image
                src={logoMark}
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
                className="object-contain"
                priority
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={closeOrToggle}
              aria-label="Buka sidebar"
              aria-expanded={false}
              title="Buka sidebar"
              className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {/* Dekoratif: nama aksesibelnya dipegang tombol ini */}
              <Image
                src={logoMark}
                alt=""
                aria-hidden="true"
                width={28}
                height={28}
                className="object-contain group-hover:hidden"
                priority
              />
              {/* Chevron putih: latarnya biru (tanpa tile putih lagi) */}
              <ChevronRight
                className="h-4 w-4 hidden group-hover:block text-white"
                aria-hidden="true"
              />
            </button>
          )}

          {expanded && (
            <span className="text-sm font-semibold text-white whitespace-nowrap overflow-hidden">
              MealChain Guardian
            </span>
          )}

          {expanded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeOrToggle();
              }}
              aria-label={isMobile ? "Tutup menu" : "Tutup sidebar"}
              title={isMobile ? "Tutup menu" : "Tutup sidebar"}
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-6 sm:w-6"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Nav items — scrollable */}
        <nav className="flex flex-col gap-1 px-2 flex-1 overflow-y-auto">
          {visibleNavItems(role).map((item) => {
            const active = isNavActive(pathname, item.href);
            const Icon = ICON_BY_HREF[item.href] ?? LayoutDashboard;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => isMobile && setMobileOpen(false)}
                aria-current={active ? "page" : undefined}
                title={!expanded ? item.label : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors sm:min-h-0",
                  expanded ? "justify-start" : "justify-center",
                  active
                    ? "bg-brand-active text-white font-medium"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {expanded && (
                  <span className="whitespace-nowrap overflow-hidden">
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User profile + logout — pinned to bottom */}
        <div className="shrink-0 border-t border-white/10 px-3 py-3 flex flex-col gap-2">
          <div className={cn("flex items-center gap-3", !expanded && "justify-center")}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold select-none">
              {initials}
            </div>
            {expanded && (
              <>
                <div className="min-w-0 flex flex-col flex-1">
                  <span className="text-sm font-medium text-white truncate">
                    {displayName}
                  </span>
                  <span className="text-xs text-white/60 truncate">
                    {displayRole}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  aria-label="Keluar"
                  title="Keluar"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:h-7 sm:w-7"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
