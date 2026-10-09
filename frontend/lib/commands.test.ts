import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavActive, visibleNavItems } from "@/lib/nav";
import { COMMAND_LIMIT, buildCommands, filterCommands, groupCommands } from "@/lib/commands";
import type { Role } from "@/lib/api/schema";

describe("nav", () => {
  it("menyembunyikan halaman khusus untuk peran lain", () => {
    const guest = visibleNavItems(null).map((i) => i.href);
    expect(guest).not.toContain("/receiving");
    expect(guest).not.toContain("/surplus");

    const head: Role = "sppg_head";
    expect(visibleNavItems(head).map((i) => i.href)).toContain("/receiving");

    const monitor: Role = "bgn_monitor";
    expect(visibleNavItems(monitor).map((i) => i.href)).not.toContain("/receiving");
    expect(visibleNavItems(monitor).map((i) => i.href)).toContain("/suppliers");
  });

  it("tidak ada href ganda", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("halaman selalu aktif untuk sub-route", () => {
    expect(isNavActive("/decisions/dec-001", "/decisions")).toBe(true);
    expect(isNavActive("/decisions", "/decisions")).toBe(true);
    expect(isNavActive("/dashboard", "/decisions")).toBe(false);
  });
});

describe("buildCommands", () => {
  it("halaman mengikuti peran", () => {
    const head = buildCommands({ role: "sppg_head" }).map((c) => c.href);
    expect(head).toContain("/receiving");
    const monitor = buildCommands({ role: "bgn_monitor" }).map((c) => c.href);
    expect(monitor).not.toContain("/receiving");
  });

  it("memasukkan keputusan, pemasok, dan lokasi yang diberikan", () => {
    const commands = buildCommands({
      role: "sppg_head",
      decisions: [{ id: "dec-001", title: "Alih pasokan telur", locationName: "SPPG Jakarta Utara" }],
      suppliers: [{ id: "SUP-005", name: "CV Cianjur Segar" }],
      locations: [{ id: "loc-1", name: "Gudang Cianjur" }],
      canApprove: true,
    });
    const ids = commands.map((c) => c.id);
    expect(ids).toContain("decision:dec-001");
    expect(ids).toContain("supplier:SUP-005");
    expect(ids).toContain("location:loc-1");
    expect(ids).toContain("action:approvals");
  });

  it("tanpa hak approve tidak ada perintah persetujuan", () => {
    const commands = buildCommands({ role: "bgn_monitor", canApprove: false });
    expect(commands.map((c) => c.id)).not.toContain("action:approvals");
  });
});

describe("filterCommands", () => {
  const commands = buildCommands({
    role: "sppg_head",
    decisions: [{ id: "dec-001", title: "Alih pasokan telur", locationName: "SPPG Jakarta Utara" }],
    suppliers: [{ id: "SUP-005", name: "CV Cianjur Segar" }],
  });

  it("kueri kosong mengembalikan semuanya (terbatas)", () => {
    expect(filterCommands(commands, "   ").length).toBe(Math.min(commands.length, COMMAND_LIMIT));
  });

  it("cocok tanpa peduli huruf besar/kecil dan lewat id", () => {
    expect(filterCommands(commands, "TELUR").map((c) => c.id)).toContain("decision:dec-001");
    expect(filterCommands(commands, "sup-005").map((c) => c.id)).toContain("supplier:SUP-005");
  });

  it("semua kata harus muncul", () => {
    expect(filterCommands(commands, "telur cianjur")).toHaveLength(0);
    expect(filterCommands(commands, "jakarta utara").map((c) => c.id)).toContain("decision:dec-001");
  });

  it("menghormati batas hasil", () => {
    const many = buildCommands({
      decisions: Array.from({ length: 30 }, (_, i) => ({ id: `dec-${i}` })),
    });
    expect(filterCommands(many, "dec")).toHaveLength(COMMAND_LIMIT);
  });
});

describe("groupCommands", () => {
  it("mengelompokkan dengan urutan tetap dan membuang grup kosong", () => {
    const commands = buildCommands({
      role: "sppg_head",
      decisions: [{ id: "dec-001", title: "x" }],
    });
    const groups = groupCommands(commands);
    expect(groups[0].group).toBe("Halaman");
    expect(groups.map((g) => g.group)).toContain("Keputusan");
    expect(groups.map((g) => g.group)).not.toContain("Lokasi");
  });
});
