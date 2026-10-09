import { describe, it, expect } from "vitest";
import { expiryLabel, expiryState, expiryTone, remainingMs } from "./expiry";

/**
 * design.md §3.3: countdown `expires_at` ditampilkan di layar keputusan; kalau
 * lewat batas, badge berubah jadi "Kedaluwarsa". Schema.md §3: `expires_at` =
 * min(batch.usable_until, SLA per komoditas) dan keputusan yang lewat batas tidak
 * pernah `executed` — jadi UI tidak boleh menyembunyikan keadaan itu.
 *
 * Semua fungsi di sini menerima `now` supaya bisa diuji deterministik.
 */
const NOW = new Date("2026-10-07T10:00:00.000Z").getTime();
const inMinutes = (m: number) =>
  new Date(NOW + m * 60_000).toISOString();

describe("remainingMs", () => {
  it("menghitung sisa waktu dalam ms", () => {
    expect(remainingMs(inMinutes(90), NOW)).toBe(90 * 60_000);
  });

  it("nilai negatif bila sudah lewat (bukan diklem ke nol)", () => {
    expect(remainingMs(inMinutes(-5), NOW)).toBe(-5 * 60_000);
  });

  it("null bila tidak ada atau tidak valid — bukan menebak", () => {
    expect(remainingMs(undefined, NOW)).toBeNull();
    expect(remainingMs("", NOW)).toBeNull();
    expect(remainingMs("bukan-tanggal", NOW)).toBeNull();
  });
});

describe("expiryState", () => {
  it("tanpa expires_at → 'none' (banyak keputusan lama belum punya SLA)", () => {
    expect(expiryState(undefined, NOW)).toBe("none");
  });

  it("lewat batas → 'expired'", () => {
    expect(expiryState(inMinutes(-1), NOW)).toBe("expired");
    expect(expiryState(inMinutes(0), NOW)).toBe("expired");
  });

  it("di bawah 15 menit → 'critical' (masih bisa dieksekusi, tapi mepet)", () => {
    expect(expiryState(inMinutes(14), NOW)).toBe("critical");
  });

  it("di bawah 2 jam → 'warning'", () => {
    expect(expiryState(inMinutes(15), NOW)).toBe("warning");
    expect(expiryState(inMinutes(119), NOW)).toBe("warning");
  });

  it("2 jam atau lebih → 'safe'", () => {
    expect(expiryState(inMinutes(120), NOW)).toBe("safe");
  });
});

describe("expiryTone", () => {
  it("memetakan keadaan ke nada token design.md (tanpa warna baru)", () => {
    expect(expiryTone("safe")).toBe("safe");
    expect(expiryTone("warning")).toBe("warning");
    expect(expiryTone("critical")).toBe("danger");
    expect(expiryTone("expired")).toBe("danger");
    expect(expiryTone("none")).toBe("neutral");
  });
});

describe("expiryLabel", () => {
  it("lewat batas → 'Kedaluwarsa' (kata yang dipakai design.md §3.3)", () => {
    expect(expiryLabel(inMinutes(-30), NOW)).toBe("Kedaluwarsa");
  });

  it("menyebut jam + menit untuk sisa panjang", () => {
    expect(expiryLabel(inMinutes(130), NOW)).toBe("Sisa 2 jam 10 menit");
  });

  it("menyebut menit saja bila di bawah 1 jam", () => {
    expect(expiryLabel(inMinutes(26), NOW)).toBe("Sisa 26 menit");
  });

  it("menyebut detik bila di bawah 1 menit (biar terasa mendesak)", () => {
    expect(expiryLabel(inMinutes(0.5), NOW)).toBe("Sisa 30 detik");
  });

  it("tanpa expires_at → '-' (bukan klaim waktu karangan)", () => {
    expect(expiryLabel(undefined, NOW)).toBe("-");
  });
});
