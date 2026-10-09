import { describe, it, expect } from "vitest";
import { approvalDenialReason, canApproveDecision, decodeJwt } from "./auth";
import type { JwtPayload } from "./api/schema";

/**
 * Batasan approval untuk TIGA akun demo:
 *   sppg_head (DKI Jakarta), sppg_nutritionist (Jawa Barat), bgn_monitor (read-only).
 *
 * Fokus bug yang dijaga: approve ditentukan oleh region LOKASI TUJUAN, bukan
 * lokasi asal — kalau tertukar, kepala DKI bisa menyetujui pengiriman ke luar
 * wilayahnya hanya karena asalnya di DKI.
 */

const b64url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const tokenFor = (payload: JwtPayload) =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(
    JSON.stringify(payload),
  )}.sig`;

const KEPALA_DKI = decodeJwt(
  tokenFor({
    sub: "user-sppg-head",
    role: "sppg_head",
    region: "DKI Jakarta",
    canApprove: true,
    exp: 9999999999,
  }),
);
const AHLI_GIZI_JABAR = decodeJwt(
  tokenFor({
    sub: "user-nutritionist",
    role: "sppg_nutritionist",
    region: "Jawa Barat",
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

describe("canApproveDecision — batasan wilayah per akun", () => {
  it("kepala SPPG DKI boleh approve keputusan ke lokasi DKI", () => {
    expect(
      canApproveDecision(KEPALA_DKI, { targetLocationId: "loc-2" }, locations),
    ).toBe(true);
  });

  it("kepala SPPG DKI TIDAK boleh approve keputusan ke Jawa Barat", () => {
    expect(
      canApproveDecision(KEPALA_DKI, { targetLocationId: "loc-6" }, locations),
    ).toBe(false);
  });

  it("asal di DKI tidak memberi hak approve untuk tujuan Jawa Barat", () => {
    // Inti aturannya: yang menentukan region adalah lokasi TUJUAN.
    const keputusan = { targetLocationId: "loc-10", sourceLocationId: "loc-2" };
    expect(canApproveDecision(KEPALA_DKI, keputusan, locations)).toBe(false);
  });

  it("ahli gizi Jawa Barat boleh approve tujuan Jawa Barat, bukan DKI", () => {
    expect(
      canApproveDecision(AHLI_GIZI_JABAR, { targetLocationId: "loc-6" }, locations),
    ).toBe(true);
    expect(
      canApproveDecision(AHLI_GIZI_JABAR, { targetLocationId: "loc-5" }, locations),
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
      canApproveDecision(KEPALA_DKI, { targetLocationId: "loc-999" }, locations),
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
      approvalDenialReason(KEPALA_DKI, { targetLocationId: "loc-2" }, locations),
    ).toBeNull();
  });

  it("di luar wilayah peran dibedakan dari read-only", () => {
    expect(
      approvalDenialReason(KEPALA_DKI, { targetLocationId: "loc-6" }, locations),
    ).toBe("outside-region");
    expect(
      approvalDenialReason(MONITOR_BGN, { targetLocationId: "loc-6" }, locations),
    ).toBe("read-only");
  });

  it("lokasi tujuan tak dikenal dan payload kosong punya alasan sendiri", () => {
    expect(
      approvalDenialReason(KEPALA_DKI, { targetLocationId: "loc-999" }, locations),
    ).toBe("unknown-location");
    expect(
      approvalDenialReason(null, { targetLocationId: "loc-2" }, locations),
    ).toBe("no-role");
  });
});
