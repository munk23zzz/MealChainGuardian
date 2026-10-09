import { describe, it, expect } from "vitest";
import {
  ROLE_LABELS,
  isGlobalRole,
  isRegionalRole,
  isSingleLocationRole,
  roleLine,
  scopeForRole,
} from "./role";

/**
 * Role-aware by default (design.md §1.4 + §2):
 * - sppg_staff  → hanya lokasi sendiri
 * - sppg_head / sppg_nutritionist → wilayah (region) sendiri
 * - bgn_monitor / dinas_admin → lintas wilayah
 */

describe("klasifikasi role", () => {
  it("peran wilayah: kepala & ahli gizi SPPG", () => {
    expect(isRegionalRole("sppg_head")).toBe(true);
    expect(isRegionalRole("sppg_nutritionist")).toBe(true);
    expect(isRegionalRole("bgn_monitor")).toBe(false);
  });

  it("peran lintas wilayah: monitor BGN & admin dinas", () => {
    expect(isGlobalRole("bgn_monitor")).toBe(true);
    expect(isGlobalRole("dinas_admin")).toBe(true);
    expect(isGlobalRole("sppg_head")).toBe(false);
  });

  it("peran satu lokasi: staff SPPG", () => {
    expect(isSingleLocationRole("sppg_staff")).toBe(true);
    expect(isSingleLocationRole("sppg_head")).toBe(false);
  });

  it("role kosong tidak dianggap punya hak apa pun", () => {
    expect(isRegionalRole(null)).toBe(false);
    expect(isGlobalRole(null)).toBe(false);
    expect(isSingleLocationRole(undefined)).toBe(false);
  });
});

describe("scopeForRole", () => {
  it("staff SPPG → satu lokasi", () => {
    expect(
      scopeForRole("sppg_staff", { region: null, locationId: "loc-5" }),
    ).toEqual({ kind: "location", locationId: "loc-5" });
  });

  it("kepala/ahli gizi SPPG → wilayah", () => {
    expect(
      scopeForRole("sppg_head", { region: "DKI Jakarta", locationId: null }),
    ).toEqual({ kind: "region", region: "DKI Jakarta" });
  });

  it("monitor BGN & admin dinas → semua wilayah", () => {
    expect(scopeForRole("bgn_monitor", { region: null, locationId: null })).toEqual({
      kind: "all",
    });
    expect(scopeForRole("dinas_admin", { region: null, locationId: null })).toEqual({
      kind: "all",
    });
  });

  it("gagal-tertutup: peran wilayah/lokasi tanpa data pendukung tidak dapat akses semua", () => {
    // Region kosong pada sppg_head JANGAN jadi "all" — itu kebocoran data lintas wilayah.
    expect(scopeForRole("sppg_head", { region: null, locationId: null })).toEqual({
      kind: "location",
      locationId: "",
    });
    expect(
      scopeForRole("sppg_staff", { region: "DKI Jakarta", locationId: null }),
    ).toEqual({ kind: "location", locationId: "" });
  });

  it("peran global tetap 'all' walau tanpa region", () => {
    expect(scopeForRole("dinas_admin", { region: null, locationId: null }).kind).toBe(
      "all",
    );
  });
});

describe("roleLine (label identitas peran untuk UI)", () => {
  it("menyusun label + cakupan + hak aksi", () => {
    expect(
      roleLine({
        role: "sppg_head",
        region: "DKI Jakarta",
        locationId: null,
        canApprove: true,
      }),
    ).toBe("Kepala SPPG · DKI Jakarta · bisa approve");
  });

  it("read-only ditulis eksplisit, bukan dibiarkan kosong", () => {
    expect(
      roleLine({
        role: "bgn_monitor",
        region: null,
        locationId: null,
        canApprove: false,
      }),
    ).toBe("Monitor BGN · semua wilayah · read-only");
  });

  it("staff SPPG menyebut lokasi sendiri", () => {
    expect(
      roleLine({
        role: "sppg_staff",
        region: null,
        locationId: "loc-5",
        canApprove: true,
      }),
    ).toBe("Staff SPPG · lokasi sendiri · bisa approve");
  });

  it("peran tak dikenal tidak mengarang label", () => {
    expect(ROLE_LABELS.dinas_admin).toBe("Admin Dinas");
    expect(
      roleLine({ role: null, region: null, locationId: null, canApprove: false }),
    ).toBe("Tanpa peran · semua wilayah · read-only");
  });
});
