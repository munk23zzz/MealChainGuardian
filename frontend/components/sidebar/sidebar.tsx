"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/contexts/sidebar";
import { useAuth } from "@/contexts/auth";
import {
  LayoutDashboard,
  ClipboardList,
  ScrollText,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/decisions", label: "Keputusan", icon: ClipboardList },
  { href: "/agent-log", label: "Agent Log", icon: ScrollText },
  { href: "/kpi",       label: "KPI",       icon: BarChart3 },
];

const ROLE_LABELS: Record<string, string> = {
  dinas_admin: "Dinas Admin",
  sppg_staff:  "Staff SPPG",
};

export function Sidebar() {
  const pathname = usePathname();
  const { isOpen, toggle } = useSidebar();
  const { user, role, logout } = useAuth();

  // Inisial dari nama user, fallback ke role
  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (role ?? "?").slice(0, 2).toUpperCase();

  const displayName = user?.name || role || "-";
  const displayRole = ROLE_LABELS[role ?? ""] ?? role ?? "-";

  return (
    <aside
      style={{ backgroundColor: "#0969DA" }}
      className={cn(
        "relative shrink-0 flex flex-col transition-all duration-300 ease-in-out overflow-hidden h-screen sticky top-0",
        isOpen ? "w-64" : "w-16"
      )}
    >
      {/* Logo / Brand — klik logo saat sidebar tertutup untuk membuka */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-4 shrink-0",
          !isOpen && "cursor-pointer"
        )}
        onClick={!isOpen ? toggle : undefined}
        title={!isOpen ? "Buka sidebar" : undefined}
      >
        <div className={cn(
          "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white text-xs font-bold select-none transition-colors",
          !isOpen && "group hover:bg-white/30"
        )}>
          <span className={cn(!isOpen && "group-hover:hidden")}>MG</span>
          {!isOpen && (
            <ChevronRight className="h-4 w-4 hidden group-hover:block" aria-hidden="true" />
          )}
        </div>

        {isOpen && (
          <span className="text-sm font-semibold text-white whitespace-nowrap overflow-hidden">
            MealChain Guardian
          </span>
        )}

        {isOpen && (
          <button
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            title="Tutup sidebar"
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Nav items — scrollable */}
      <nav className="flex flex-col gap-1 px-2 flex-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!isOpen ? item.label : undefined}
              style={active ? { backgroundColor: "#0550AE" } : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isOpen ? "justify-start" : "justify-center",
                active
                  ? "text-white font-medium"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {isOpen && (
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
        {/* User info + logout */}
        <div className={cn("flex items-center gap-3", !isOpen && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold select-none">
            {initials}
          </div>
          {isOpen && (
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
                onClick={logout}
                title="Keluar"
                className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
