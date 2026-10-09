/**
 * Command palette (Ctrl/Cmd+K) — logika murni: membangun daftar perintah dari
 * peran + data yang SUDAH ter-scope pemanggil, lalu menyaring.
 *
 * Aturan penting: filter cakupan wilayah TIDAK dilakukan di sini. Pemanggil
 * mengoper `decisions`/`suppliers` yang sudah ter-scope (lib/scope.ts) supaya
 * palette tidak pernah jadi jalan pintas menembus batasan peran.
 */

import type { Role } from "@/lib/api/schema";
import { visibleNavItems } from "@/lib/nav";

export type CommandGroup = "Halaman" | "Keputusan" | "Pemasok" | "Lokasi" | "Aksi";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: CommandGroup;
  href?: string;
  keywords?: string[];
};

export type CommandInput = {
  role?: Role | null;
  decisions?: { id: string; title?: string; locationName?: string }[];
  suppliers?: { id: string; name: string }[];
  locations?: { id: string; name: string }[];
  canApprove?: boolean;
};

export const COMMAND_LIMIT = 8;

export function buildCommands(input: CommandInput): Command[] {
  const commands: Command[] = visibleNavItems(input.role).map((item) => ({
    id: `nav:${item.href}`,
    label: item.label,
    hint: item.href,
    group: "Halaman",
    href: item.href,
    keywords: ["buka", "halaman", item.href.replace("/", "")],
  }));

  for (const decision of input.decisions ?? []) {
    commands.push({
      id: `decision:${decision.id}`,
      label: decision.title ?? decision.id,
      hint: decision.locationName ? `Keputusan · ${decision.locationName}` : "Keputusan",
      group: "Keputusan",
      href: `/decisions/${decision.id}`,
      keywords: [decision.id, decision.locationName ?? ""],
    });
  }

  for (const supplier of input.suppliers ?? []) {
    commands.push({
      id: `supplier:${supplier.id}`,
      label: supplier.name,
      hint: "Pemasok",
      group: "Pemasok",
      href: `/suppliers?focus=${supplier.id}`,
      keywords: [supplier.id, supplier.name],
    });
  }

  for (const location of input.locations ?? []) {
    commands.push({
      id: `location:${location.id}`,
      label: location.name,
      hint: "Lokasi",
      group: "Lokasi",
      href: `/dashboard?focus=${location.id}`,
      keywords: [location.id, location.name],
    });
  }

  if (input.canApprove) {
    commands.push({
      id: "action:approvals",
      label: "Keputusan menunggu persetujuan saya",
      hint: "Aksi",
      group: "Aksi",
      href: "/decisions?filter=pending_approval",
      keywords: ["approve", "persetujuan", "pending", "menunggu"],
    });
  }

  return commands;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/** Pencocokan sederhana & dapat diprediksi: semua kata kueri harus muncul. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matched =
    terms.length === 0
      ? commands
      : commands.filter((command) => {
          const haystack = normalize(
            [command.label, command.hint ?? "", ...(command.keywords ?? [])].join(" "),
          );
          return terms.every((term) => haystack.includes(term));
        });
  return matched.slice(0, COMMAND_LIMIT);
}

export function groupCommands(
  commands: Command[],
): { group: CommandGroup; items: Command[] }[] {
  const order: CommandGroup[] = ["Halaman", "Keputusan", "Pemasok", "Lokasi", "Aksi"];
  return order
    .map((group) => ({ group, items: commands.filter((c) => c.group === group) }))
    .filter((entry) => entry.items.length > 0);
}
