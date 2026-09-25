import { describe, it, expect } from "vitest";
import { isTokenExpired } from "./session";

describe("isTokenExpired", () => {
  const NOW = 1_750_000_000_000; // fixed epoch ms

  it("true jika payload null (tidak ada token)", () => {
    expect(isTokenExpired(null, NOW)).toBe(true);
  });

  it("true jika exp tidak ada", () => {
    expect(isTokenExpired({ sub: "u1" }, NOW)).toBe(true);
  });

  it("true jika exp sudah lewat", () => {
    // exp = 1_749_000_000 (detik) = lewat dari NOW
    expect(isTokenExpired({ exp: 1_749_000_000 }, NOW)).toBe(true);
  });

  it("false jika exp belum lewat", () => {
    // exp = 1_751_000_000 (detik) = masih depan dari NOW
    expect(isTokenExpired({ exp: 1_751_000_000 }, NOW)).toBe(false);
  });

  it("false tepat di batas (exp === now, bukan expired)", () => {
    const expSeconds = Math.floor(NOW / 1000);
    expect(isTokenExpired({ exp: expSeconds }, NOW)).toBe(false);
  });
});
