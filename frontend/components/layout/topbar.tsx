"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  MapPin,
  Search,
  ShieldAlert,
  UserCog,
  X,
} from "lucide-react";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { useAuth } from "@/contexts/auth";
import { roleLine, scopeForRole } from "@/lib/role";
import { decisionTouchesScope, isLocationInScope } from "@/lib/scope";
import { useDecisions, useLocations, useSupply } from "@/hooks/use-data";
import { searchAll, type SearchResult, type SearchResultType } from "@/lib/search";
import {
  deriveNotifications,
  unreadCount,
  type NotificationCategory,
  type NotificationItem,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Icon maps
// ---------------------------------------------------------------------------

const SEARCH_ICONS: Record<SearchResultType, React.ElementType> = {
  page: LayoutDashboard,
  location: MapPin,
  decision: ClipboardList,
};

const NOTIF_ICONS: Record<NotificationCategory, React.ElementType> = {
  pending_approval: ClipboardList,
  verifier_flagged: AlertTriangle,
  critical_location: MapPin,
  safety_alert: ShieldAlert,
};

const NOTIF_COLORS: Record<NotificationCategory, string> = {
  pending_approval: "text-status-warning",
  verifier_flagged: "text-status-danger",
  critical_location: "text-status-danger",
  safety_alert: "text-status-danger",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "baru saja";
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  return `${Math.floor(hrs / 24)} hari lalu`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SearchDropdown({
  results,
  query,
  onSelect,
  onClear,
}: {
  results: SearchResult[];
  query: string;
  onSelect: (r: SearchResult) => void;
  onClear: () => void;
}) {
  if (!query.trim()) return null;

  return (
    <div className="absolute top-full left-0 mt-2 w-full min-w-[320px] rounded-lg bg-white shadow-xl ring-1 ring-black/10 z-50 overflow-hidden">
      {results.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Search className="h-4 w-4 shrink-0" />
          <span>Tidak ada hasil untuk &ldquo;{query}&rdquo;</span>
        </div>
      ) : (
        <ul role="listbox" className="divide-y divide-border max-h-72 overflow-y-auto">
          {results.map((r) => {
            const Icon = SEARCH_ICONS[r.type];
            return (
              <li key={r.id}>
                <button
                  role="option"
                  aria-selected={false}
                  onClick={() => onSelect(r)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-brand/5 transition-colors"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy-900">
                      {r.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.subtitle}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-grey-500" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Clear */}
      <div className="border-t border-border px-4 py-2 flex justify-end">
        <button
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-navy-900 flex items-center gap-1 transition-colors"
        >
          <X className="h-3 w-3" />
          Hapus pencarian
        </button>
      </div>
    </div>
  );
}

function NotificationPanel({
  items,
  onNavigate,
  onMarkAllRead,
  onClose,
}: {
  items: NotificationItem[];
  onNavigate: (href: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
}) {
  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="absolute top-full right-0 mt-2 w-80 rounded-lg bg-white shadow-xl ring-1 ring-black/10 z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-navy-900">
          Notifikasi
          {unread > 0 && (
            <span className="ml-2 inline-flex items-center justify-center rounded-full bg-status-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 text-xs text-brand hover:text-brand-active transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Tandai semua dibaca
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-navy-900 transition-colors"
            aria-label="Tutup notifikasi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Bell className="h-8 w-8 text-navy-100" />
          <p className="text-sm text-muted-foreground">Semua sudah terbaca</p>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-border">
          {items.map((n) => {
            const Icon = NOTIF_ICONS[n.category];
            const iconColor = NOTIF_COLORS[n.category];
            return (
              <li key={n.id}>
                <button
                  onClick={() => onNavigate(n.href)}
                  className={[
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted",
                    !n.read ? "bg-brand/5" : "",
                  ].join(" ")}
                >
                  <span className={`mt-0.5 shrink-0 ${iconColor}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block text-sm font-medium text-navy-900 truncate">
                        {n.title}
                      </span>
                      {!n.read && (
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                      {n.description}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer */}
      {items.length > 0 && (
        <div className="border-t border-border px-4 py-2.5 text-center">
          <button
            onClick={() => onNavigate("/decisions")}
            className="text-xs text-brand hover:text-brand-active font-medium transition-colors"
          >
            Lihat semua keputusan →
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopBar
// ---------------------------------------------------------------------------

export function TopBar() {
  const router = useRouter();
  const { role, region, locationId, canApprove } = useAuth();

  // Data for search + notifications
  const { data: decisions = [] } = useDecisions({ demo: true });
  const { data: locations = [] } = useLocations();
  const { data: supply = [] } = useSupply();

  /**
   * Cakupan peran juga berlaku untuk pencarian & notifikasi (design.md §1.4):
   * kalau tidak, kepala SPPG Jakarta bisa menemukan keputusan Jawa Barat lewat
   * kotak cari — jalan pintas yang membatalkan batasan halaman.
   */
  const roleScope = useMemo(
    () => scopeForRole(role, { region, locationId }),
    [role, region, locationId],
  );
  const scopedDecisions = useMemo(
    () => decisions.filter((d) => decisionTouchesScope(d, roleScope, locations)),
    [decisions, roleScope, locations],
  );
  const scopedLocations = useMemo(
    () => locations.filter((l) => isLocationInScope(l.id, roleScope, locations)),
    [locations, roleScope],
  );

  // Search state
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Notification state
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Derived data — dibatasi cakupan peran (lihat roleScope di atas).
  const rawNotifications = deriveNotifications(
    scopedDecisions,
    scopedLocations,
    supply,
  );
  const notifications: NotificationItem[] = rawNotifications.map((n) => ({
    ...n,
    read: readIds.has(n.id),
  }));
  const badge = unreadCount(notifications);

  const searchResults = searchAll(query, scopedDecisions, scopedLocations);

  // ---------------------------------------------------------------------------
  // Close on outside click
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      router.push(result.href);
      setQuery("");
      setSearchOpen(false);
    },
    [router],
  );

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSearchOpen(true);
  };

  const handleNotifNavigate = useCallback(
    (href: string) => {
      // Mark all visible as read on navigate
      setReadIds((prev) => {
        const next = new Set(prev);
        notifications.forEach((n) => next.add(n.id));
        return next;
      });
      router.push(href);
      setNotifOpen(false);
    },
    [router, notifications],
  );

  const handleMarkAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      return next;
    });
  }, [notifications]);

  const toggleNotif = () => {
    setNotifOpen((v) => !v);
    setSearchOpen(false);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <header className="flex items-center gap-4 bg-brand text-white border-b border-white/10 px-4 py-3">
      {/* Left — data source badge + identitas peran (design.md §1.4) */}
      <div className="flex flex-1 items-center gap-3">
        <DataSourceBadge />
        {role && (
          <span
            className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90 lg:inline-flex"
            title="Peran Anda dan cakupan data yang ditampilkan"
          >
            <UserCog className="h-3.5 w-3.5" aria-hidden />
            {roleLine({ role, region, locationId, canApprove })}
          </span>
        )}
      </div>

      {/* Search */}
      <div ref={searchRef} className="relative w-64">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => query && setSearchOpen(true)}
          placeholder="Cari keputusan, lokasi…"
          aria-label="Cari"
          autoComplete="off"
          className="w-full rounded-md bg-white/10 py-1.5 pl-9 pr-3 text-sm text-white placeholder:text-white/60 outline-none focus:ring-2 focus:ring-white/40 transition"
        />
        {searchOpen && (
          <SearchDropdown
            results={searchResults}
            query={query}
            onSelect={handleSearchSelect}
            onClear={() => { setQuery(""); setSearchOpen(false); }}
          />
        )}
      </div>

      {/* Notification bell */}
      <div ref={notifRef} className="relative">
        <button
          type="button"
          onClick={toggleNotif}
          aria-label={`Notifikasi${badge > 0 ? `, ${badge} belum dibaca` : ""}`}
          aria-expanded={notifOpen}
          className="relative rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition"
        >
          <Bell className="h-5 w-5" />
          {badge > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-status-danger text-[9px] font-bold text-white">
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </button>
        {notifOpen && (
          <NotificationPanel
            items={notifications}
            onNavigate={handleNotifNavigate}
            onMarkAllRead={handleMarkAllRead}
            onClose={() => setNotifOpen(false)}
          />
        )}
      </div>
    </header>
  );
}
