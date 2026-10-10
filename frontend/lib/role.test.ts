import { describe, it, expect } from "vitest";
import {
  ROLE_LABELS,
  isGlobalRole,
  isLocationBoundRole,
  roleLine,
  scopeForRole,
} from "./role";

/**
 * Role-aware by default (design.md §1.4 + §2), revisi 10 Okt 2026:
 * - sppg_head / sppg_nutritionist / sppg_staff → SATU SPPG (lokasi) sendiri
 * - bgn_monitor / dinas_admin → lintas wilayah
 *
 * Alasan perubahan: backend sudah lebih dulu menegakkan "satu orang = satu SPPG"
 * (`backend/app/core/approval_rules.py`: approver harus dari SPPG penerima). Sebelum ini
 * frontend memberi kepala SPPG cakupan seluruh WILAYAH, sehingga UI menawarkan tombol
 * Approve untuk keputusan SPPG lain di wilayah yang sama — approval yang pasti ditolak
 * server (`approver_location_mismatch`).
 */

const locations = [
  { id: "loc-2", name: "SPPG Jakarta Utara" },
  { id: "loc-5", name: "SPPG Jakarta Timur" },
];

describe("klasifikasi role", () => {
  it("peran terikat satu SPPG: kepala, ahli gizi, staff", () => {
    expect(isLocationBoundRole("sppg_head")).toBe(true);
    expect(isLocationBoundRole("sppg_nutritionist")).toBe(true);
    expect(isLocationBoundRole("sppg_staff")).toBe(true);
  });

  it("peran lintas wilayah: monitor BGN & admin dinas", () => {
    expect(isGlobalRole("bgn_monitor")).toBe(true);
    expect(isGlobalRole("dinas_admin")).toBe(true);
    expect(isGlobalRole("sppg_head")).toBe(false);
  });

  it("role kosong tidak dianggap punya hak apa pun", () => {
    expect(isLocationBoundRole(null)).toBe(false);
    expect(isLocationBoundRole(undefined)).toBe(false);
    expect(isGlobalRole(null)).toBe(false);
  });
});

describe("scopeForRole", () => {
  it("kepala SPPG → SPPG-nya sendiri, bukan seluruh wilayah", () => {
    expect(
      scopeForRole("sppg_head", { region: "DKI Jakarta", locationId: "loc-2" }),
    ).toEqual({ kind: "location", locationId: "loc-2" });
  });

  it("ahli gizi SPPG → lokasinya, staff SPPG → lokasinya", () => {
    expect(
      scopeForRole("sppg_nutritionist", {
        region: "DKI Jakarta",
        locationId: "loc-2",
      }),
    ).toEqual({ kind: "location", locationId: "loc-2" });
    expect(
      scopeForRole("sppg_staff", { region: null, locationId: "loc-5" }),
    ).toEqual({ kind: "location", locationId: "loc-5" });
  });

  it("monitor BGN & admin dinas → semua wilayah", () => {
    expect(scopeForRole("bgn_monitor", { region: null, locationId: null })).toEqual({
      kind: "all",
    });
    expect(scopeForRole("dinas_admin", { region: null, locationId: null })).toEqual({
      kind: "all",
    });
  });

  it("gagal-tertutup: peran terikat tanpa locationId tidak dapat akses semua", () => {
    // Region yang terisi JANGAN menaikkan cakupan jadi "all" — itu kebocoran antar SPPG.
    expect(
      scopeForRole("sppg_head", { region: "DKI Jakarta", locationId: null }),
    ).toEqual({ kind: "location", locationId: "" });
    expect(
      scopeForRole("sppg_nutritionist", { region: "Jawa Barat", locationId: null }),
    ).toEqual({ kind: "location", locationId: "" });
  });

  it("peran global tetap 'all' walau tanpa locationId", () => {
    expect(scopeForRole("dinas_admin", { region: null, locationId: null }).kind).toBe(
      "all",
    );
  });
});

describe("roleLine (label identitas peran untuk UI)", () => {
  it("menyebut NAMA SPPG kalau daftar lokasi tersedia", () => {
    expect(
      roleLine(
        {
          role: "sppg_head",
          region: "DKI Jakarta",
          locationId: "loc-2",
          canApprove: true,
        },
        locations,
      ),
    ).toBe("Kepala SPPG · SPPG Jakarta Utara · bisa approve");
  });

  it("tanpa daftar lokasi tidak mengarang nama SPPG", () => {
    expect(
      roleLine({
        role: "sppg_head",
        region: "DKI Jakarta",
        locationId: "loc-2",
        canApprove: true,
      }),
    ).toBe("Kepala SPPG · SPPG Anda · bisa approve");
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

  it("peran tak dikenal tidak mengarang label", () => {
    expect(ROLE_LABELS.dinas_admin).toBe("Admin Dinas");
    expect(
      roleLine({ role: null, region: null, locationId: null, canApprove: false }),
    ).toBe("Tanpa peran · semua wilayah · read-only");
  });
});
