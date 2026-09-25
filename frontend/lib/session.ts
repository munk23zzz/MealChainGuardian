/**
 * Session helpers murni (pure functions) — cek kedaluwarsa token.
 */
import type { JwtPayload } from "./api/schema";

/**
 * Token dianggap kedaluwarsa jika payload null, tidak punya `exp`,
 * atau `exp` (dalam detik) sudah <= now. Batas sama dengan now = belum expired.
 */
export function isTokenExpired(payload: JwtPayload | null, nowMs: number = Date.now()): boolean {
  if (!payload || typeof payload.exp !== "number") {
    return true;
  }
  return payload.exp * 1000 < nowMs;
}
