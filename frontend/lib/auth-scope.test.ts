import { describe, it, expect } from "vitest";
import { approvalDenialReason, canApproveDecision, decodeJwt } from "./auth";
import type { JwtPayload } from "./api/schema";

/**
 * Batasan approval untuk TIGA akun demo (revisi 10 Okt 2026):
 *   sppg_head (SPPG Jakarta Utara), sppg_nutritionist (SPPG Jakarta Utara), bgn_monitor.
 *
 * Fokus bug yang dijaga: approve ditentukan oleh **lokasi TUJUAN** dan hanya untuk
 * **SPPG approver sendiri** — bukan seluruh wilayah. Sebelum revisi, kepala SPPG Jakarta
 * Utara boleh menyetujui pengiriman ke SPPG DKI lain (mis. loc-5 Jakarta Timur); server
 * menolaknya (`approver_location_mismatch`), jadi UI menjanjikan sesuatu yang tidak ada.
 */

const b64url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const tokenFor = (payload: JwtPayload) =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify(payload),
  )}.sig`;

const KEPALA_JAKUT = decodeJwt(
  tokenFor({
    sub: "user-sppg-head",
    role: "sppg_head",
    locationId: "loc-2",
    region: "DKI Jakarta",
    canApprove: true,
    exp: 9999999999,
  }),
);
const KEPALA_TANPA_LOKASI = decodeJwt(
  tokenFor({
    sub: "user-sppg-head-tanpa-sppg",
    role: "sppg_head",
    region: "DKI Jakarta",
    canApprove: true,
    exp: 9999999999,
  }),
);
const AHLI_GIZI_JAKUT = decodeJwt(
  tokenFor({
    sub: "user-nutritionist",
    role: "sppg_nutritionist",
    locationId: "loc-2",
    region: "DKI Jakarta",
    canApprove: true,
    exp: 9999999999,
  }),
);
const MONITOR_BGN = decodeJwt(
  tokenFor({
    sub: "user-bgn-monitor",
    role: "bgn_monitor",
    canApprove: false,
    exp: 9999999999,
  }),
);

const locations = [
  { id: "loc-2", region: "DKI Jakarta" },
  { id: "loc-5", region: "DKI Jakarta" },
  { id: "loc-6", region: "Jawa Barat" },
  { id: "loc-10", region: "Jawa Barat" },
];

describe("canApproveDecision — batasan satu SPPG per akun", () => {
  it("kepala SPPG boleh approve keputusan ke SPPG-nya sendiri", () => {
    expect(
      canApproveDecision(KEPALA_JAKUT, { targetLocationId: "loc-2" }, locations),
    ).toBe(true);
  });

  it("kepala SPPG TIDAK boleh approve SPPG lain di wilayah yang sama", () => {
    // Inilah keputusan yang berubah 10 Okt: dulu loc-5 masih "DKI Jakarta", jadi boleh.
    expect(
      canApproveDecision(KEPALA_JAKUT, { targetLocationId: "loc-5" }, locations),
    ).toBe(false);
  });

  it("kepala SPPG TIDAK boleh approve SPPG di wilayah lain", () => {
    expect(
      canApproveDecision(KEPALA_JAKUT, { targetLocationId: "loc-6" }, locations),
    ).toBe(false);
  });

  it("asal di SPPG-nya tidak memberi hak approve untuk tujuan SPPG lain", () => {
    const keputusan = { targetLocationId: "loc-10", sourceLocationId: "loc-2" };
    expect(canApproveDecision(KEPALA_JAKUT, keputusan, locations)).toBe(false);
  });

  it("kepala SPPG tanpa locationId tidak bisa approve apa pun (gagal-tertutup)", () => {
    expect(
      canApproveDecision(KEPALA_TANPA_LOKASI, { targetLocationId: "loc-2" }, locations),
    ).toBe(false);
  });

  it("ahli gizi SPPG punya batas yang sama dengan kepala SPPG", () => {
    expect(
      canApproveDecision(AHLI_GIZI_JAKUT, { targetLocationId: "loc-2" }, locations),
    ).toBe(true);
    expect(
      canApproveDecision(AHLI_GIZI_JAKUT, { targetLocationId: "loc-6" }, locations),
    ).toBe(false);
  });

  it("monitor BGN tidak boleh approve apa pun", () => {
    for (const location of locations) {
      expect(
        canApproveDecision(MONITOR_BGN, { targetLocationId: location.id }, locations),
      ).toBe(false);
    }
  });

  it("lokasi tujuan tak dikenal → ditolak (gagal-tertutup)", () => {
    expect(
      canApproveDecision(KEPALA_JAKUT, { targetLocationId: "loc-999" }, locations),
    ).toBe(false);
  });

  it("tanpa payload → ditolak", () => {
    expect(canApproveDecision(null, { targetLocationId: "loc-2" }, locations)).toBe(
      false,
    );
  });
});

describe("approvalDenialReason — kalimat penjelasan untuk UI", () => {
  it("boleh approve → tidak ada alasan penolakan", () => {
    expect(
      approvalDenialReason(KEPALA_JAKUT, { targetLocationId: "loc-2" }, locations),
    ).toBeNull();
  });

  it("di luar SPPG peran dibedakan dari read-only", () => {
    expect(
      approvalDenialReason(KEPALA_JAKUT, { targetLocationId: "loc-5" }, locations),
    ).toBe("outside-sppg");
    expect(
      approvalDenialReason(MONITOR_BGN, { targetLocationId: "loc-6" }, locations),
    ).toBe("read-only");
  });

  it("lokasi tujuan tak dikenal dan payload kosong punya alasan sendiri", () => {
    expect(
      approvalDenialReason(KEPALA_JAKUT, { targetLocationId: "loc-999" }, locations),
    ).toBe("unknown-location");
    expect(
      approvalDenialReason(null, { targetLocationId: "loc-2" }, locations),
    ).toBe("no-role");
  });
});
