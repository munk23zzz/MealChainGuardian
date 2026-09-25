/**
 * Route-guard helpers murni (pure functions) — menentukan halaman mana yang
 * butuh login dan ke mana redirect berdasarkan status auth.
 */

const PROTECTED_PREFIXES = ["/dashboard", "/decisions", "/agent-log", "/kpi"];

/**
 * Status auth. `loading` = token sedang dibaca dari localStorage (setelah mount),
 * jadi guard BELUM boleh memutuskan redirect apa pun.
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

/** Halaman yang butuh login (dashboard + turunannya). */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Redirect yang harus dilakukan berdasarkan status auth dan path saat ini.
 * Return null jika tidak perlu redirect.
 */
export function getRedirectForAuthState(
  status: AuthStatus,
  pathname: string,
): string | null {
  if (status === "loading") {
    return null;
  }
  if (status === "unauthenticated" && isProtectedPath(pathname)) {
    return "/login";
  }
  if (status === "authenticated" && (pathname === "/" || pathname === "/login")) {
    return "/dashboard";
  }
  return null;
}
