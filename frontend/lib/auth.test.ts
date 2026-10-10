import { describe, it, expect } from "vitest";
import { decodeJwt, hasRole, canApproveForLocation } from "./auth";

// Token uji: header.payload.signature dengan payload base64url.
// Payload: {"sub":"u1","role":"dinas_admin","exp":9999999999}
const DINAS_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSIsInJvbGUiOiJkaW5hc19hZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.sig";

// Payload: {"sub":"u2","role":"sppg_staff","locationId":"jakarta"}
const SPPG_JAKARTA_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MiIsInJvbGUiOiJzcHBnX3N0YWZmIiwibG9jYXRpb25JZCI6Impha2FydGEifQ.sig";

// Payload kepala SPPG dengan locationId — revisi 10 Okt 2026: satu orang = satu SPPG,
// jadi cakupan approval kepala TIDAK lagi seluruh wilayah melainkan lokasinya sendiri.
const b64url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenWith = (payload: Record<string, unknown>) =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify(payload),
  )}.sig`;
const KEPALA_TOKEN = tokenWith({
  sub: "u3",
  role: "sppg_head",
  locationId: "jakarta",
  region: "DKI Jakarta",
  canApprove: true,
});
const KEPALA_TANPA_LOKASI_TOKEN = tokenWith({
  sub: "u4",
  role: "sppg_head",
  region: "DKI Jakarta",
  canApprove: true,
});

describe("decodeJwt", () => {
  it("men-decode payload JWT yang valid", () => {
    const payload = decodeJwt(DINAS_TOKEN);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("u1");
    expect(payload?.role).toBe("dinas_admin");
  });

  it("men-decode locationId untuk sppg_staff", () => {
    const payload = decodeJwt(SPPG_JAKARTA_TOKEN);
    expect(payload?.role).toBe("sppg_staff");
    expect(payload?.locationId).toBe("jakarta");
  });

  it("mengembalikan null untuk token kosong", () => {
    expect(decodeJwt("")).toBeNull();
  });

  it("mengembalikan null untuk token tanpa 3 bagian", () => {
    expect(decodeJwt("hanya.dua")).toBeNull();
  });

  it("mengembalikan null untuk payload bukan base64url valid", () => {
    expect(decodeJwt("a.!not-base64!.c")).toBeNull();
  });
});

describe("hasRole", () => {
  it("true jika role cocok", () => {
    expect(hasRole(decodeJwt(DINAS_TOKEN), "dinas_admin")).toBe(true);
  });

  it("false jika role tidak cocok", () => {
    expect(hasRole(decodeJwt(DINAS_TOKEN), "sppg_staff")).toBe(false);
  });

  it("false untuk payload null", () => {
    expect(hasRole(null, "dinas_admin")).toBe(false);
  });
});

describe("canApproveForLocation", () => {
  it("dinas_admin bisa approve lokasi mana pun", () => {
    expect(canApproveForLocation(decodeJwt(DINAS_TOKEN), "bogor")).toBe(true);
  });

  it("sppg_staff hanya bisa approve lokasi miliknya", () => {
    expect(canApproveForLocation(decodeJwt(SPPG_JAKARTA_TOKEN), "jakarta")).toBe(
      true,
    );
  });

  it("sppg_staff tidak bisa approve lokasi lain", () => {
    expect(canApproveForLocation(decodeJwt(SPPG_JAKARTA_TOKEN), "bogor")).toBe(
      false,
    );
  });

  it("kepala SPPG hanya bisa approve SPPG-nya sendiri, bukan seluruh wilayah", () => {
    expect(canApproveForLocation(decodeJwt(KEPALA_TOKEN), "jakarta")).toBe(true);
    expect(canApproveForLocation(decodeJwt(KEPALA_TOKEN), "bogor")).toBe(false);
  });

  it("kepala SPPG tanpa locationId tidak bisa approve apa pun (gagal-tertutup)", () => {
    expect(
      canApproveForLocation(decodeJwt(KEPALA_TANPA_LOKASI_TOKEN), "jakarta"),
    ).toBe(false);
  });

  it("payload null tidak bisa approve", () => {
    expect(canApproveForLocation(null, "jakarta")).toBe(false);
  });
});
