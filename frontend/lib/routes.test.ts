import { describe, it, expect } from "vitest";
import { isProtectedPath, getRedirectForAuthState } from "./routes";

describe("isProtectedPath", () => {
  it("true untuk halaman dashboard dan turunannya", () => {
    expect(isProtectedPath("/dashboard")).toBe(true);
    expect(isProtectedPath("/dashboard/something")).toBe(true);
  });

  it("true untuk decisions, agent-log, kpi", () => {
    expect(isProtectedPath("/decisions")).toBe(true);
    expect(isProtectedPath("/decisions/abc-123")).toBe(true);
    expect(isProtectedPath("/agent-log")).toBe(true);
    expect(isProtectedPath("/kpi")).toBe(true);
  });

  it("false untuk login dan root", () => {
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });

  it("false untuk path tak dikenal (termasuk /map yang sudah tidak ada)", () => {
    expect(isProtectedPath("/whatever")).toBe(false);
    expect(isProtectedPath("/map")).toBe(false);
  });
});

describe("getRedirectForAuthState", () => {
  it("status masih loading -> belum memutuskan apa pun", () => {
    // Penting: token dibaca setelah mount. Kalau guard memutuskan saat loading,
    // user yang me-refresh halaman akan terlempar ke /login.
    expect(getRedirectForAuthState("loading", "/dashboard")).toBeNull();
    expect(getRedirectForAuthState("loading", "/login")).toBeNull();
  });

  it("belum login + halaman protected -> /login", () => {
    expect(getRedirectForAuthState("unauthenticated", "/dashboard")).toBe("/login");
  });

  it("belum login + halaman publik -> tidak redirect", () => {
    expect(getRedirectForAuthState("unauthenticated", "/login")).toBeNull();
  });

  it("sudah login + halaman login/root -> /dashboard", () => {
    expect(getRedirectForAuthState("authenticated", "/login")).toBe("/dashboard");
    expect(getRedirectForAuthState("authenticated", "/")).toBe("/dashboard");
  });

  it("sudah login + halaman protected -> tidak redirect", () => {
    expect(getRedirectForAuthState("authenticated", "/dashboard")).toBeNull();
  });
});
