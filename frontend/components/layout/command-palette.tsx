"use client";

/**
 * Command palette (Ctrl/Cmd+K).
 *
 * Aturan penting: daftar perintah memakai data yang SUDAH ter-scope peran
 * (lib/scope) supaya kotak cari tidak menjadi jalan pintas menembus batasan
 * wilayah. Pencocokan teks ada di `lib/commands.ts` (teruji).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { useDecisions, useLocations, useSuppliers } from "@/hooks/use-data";
import { buildCommands, filterCommands, groupCommands } from "@/lib/commands";
import { DECISION_TYPE_LABELS } from "@/lib/labels";
import { scopeForRole } from "@/lib/role";
import { decisionTouchesScope, isLocationInScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const router = useRouter();
  const { role, region, locationId, canApprove } = useAuth();
  const decisionsQuery = useDecisions();
  const suppliersQuery = useSuppliers();
  const locationsQuery = useLocations();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const scope = scopeForRole(role, { region, locationId });
  const locations = useMemo(
    () => locationsQuery.data ?? [],
    [locationsQuery.data],
  );

  const commands = useMemo(() => {
    const scopedDecisions = (decisionsQuery.data ?? [])
      .filter((decision) => decisionTouchesScope(decision, scope, locations))
      .map((decision) => ({
        id: decision.id,
        title: DECISION_TYPE_LABELS[decision.decisionType] ?? decision.decisionType,
        locationName: decision.targetLocationId,
      }));

    const scopedSuppliers = (suppliersQuery.data ?? [])
      .filter((supplier) => isLocationInScope(supplier.locationId, scope, locations))
      .map((supplier) => ({ id: supplier.id, name: supplier.name }));

    return buildCommands({
      role,
      decisions: scopedDecisions,
      suppliers: scopedSuppliers,
      locations: locations
        .filter((location) => isLocationInScope(location.id, scope, locations))
        .map((location) => ({ id: location.id, name: location.name })),
      canApprove,
    });
    // `locations` sengaja jadi dependensi: scope wilayah berubah bersama daftar lokasi.
  }, [decisionsQuery.data, suppliersQuery.data, locations, scope, role, canApprove]);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = useMemo(() => groupCommands(results), [results]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isPaletteKey) {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
      }
      if (event.key === "Enter") {
        const target = results[active];
        if (target?.href) {
          event.preventDefault();
          router.push(target.href);
          close();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, active, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-navy-900/40 p-4 pt-[12vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pencarian cepat"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-navy-100 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-grey-500" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            aria-label="Cari halaman, keputusan, pemasok, atau lokasi"
            placeholder="Cari halaman, keputusan, pemasok, lokasi…"
            className="w-full bg-transparent py-1.5 text-sm text-navy-900 outline-none placeholder:text-grey-500"
          />
          <kbd className="hidden shrink-0 rounded border border-navy-100 px-1.5 py-0.5 text-[10px] text-grey-500 sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada hasil untuk “{query}”. Cakupan hasil mengikuti wilayah peran Anda.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.group} className="mb-1">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-grey-500">
                {group.group}
              </p>
              {group.items.map((item) => {
                const index = results.findIndex((result) => result.id === item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      if (item.href) {
                        router.push(item.href);
                        close();
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                      index === active
                        ? "bg-navy-700/10 text-navy-900"
                        : "text-navy-700 hover:bg-navy-100",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="shrink-0 text-xs text-grey-500">{item.hint}</span>
                    )}
                    {index === active && (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-grey-500" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
