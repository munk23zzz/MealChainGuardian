"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { JwtPayload, User } from "@/lib/api/schema";
import {
  clearToken,
  getToken,
  login as apiLogin,
  setToken,
} from "@/lib/api";
import { decodeJwt } from "@/lib/auth";
import { isTokenExpired } from "@/lib/session";
import type { AuthStatus } from "@/lib/routes";

interface AuthContextValue {
  payload: JwtPayload | null;
  user: User | null;
  role: JwtPayload["role"] | null;
  /** Lokasi tanggung jawab untuk sppg_staff (null untuk dinas_admin). */
  locationId: string | null;
  /** true saat token valid (ada, belum expired, punya payload). */
  isAuthenticated: boolean;
  /**
   * "loading" sampai token dibaca dari localStorage (setelah mount) — route guard
   * tidak boleh memutuskan redirect selama status ini.
   */
  status: AuthStatus;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Baca payload JWT yang valid dari localStorage; null jika tidak valid. */
function readValidPayload(): JwtPayload | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload) return null;
  if (isTokenExpired(payload)) return null;
  return payload;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<JwtPayload | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate sekali saat mount (client-only).
  useEffect(() => {
    setPayload(readValidPayload());
    setHydrated(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin({ username, password });
    setToken(res.token);
    const decoded = decodeJwt(res.token);
    setPayload(decoded);
    setHydrated(true);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setPayload(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const isAuthenticated = payload !== null && !isTokenExpired(payload);
    return {
      payload,
      // payload.sub bisa dipakai sebagai id; nama/role dari claims.
      user: payload
        ? { id: payload.sub ?? "", name: "", role: payload.role ?? "sppg_staff" }
        : null,
      role: payload?.role ?? null,
      locationId: payload?.locationId ?? null,
      isAuthenticated,
      status: !hydrated
        ? "loading"
        : isAuthenticated
          ? "authenticated"
          : "unauthenticated",
      login,
      logout,
    };
  }, [payload, hydrated, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth harus dipakai di dalam <AuthProvider>");
  }
  return ctx;
}
