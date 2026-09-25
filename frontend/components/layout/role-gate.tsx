"use client";

import { useAuth } from "@/contexts/auth";
import type { Role } from "@/lib/api/schema";

/**
 * Render anak hanya jika user login punya salah satu role yang diizinkan.
 * Frontend gate BUKAN pengganti backend gate — otorisasi tetap dicek backend.
 */
export function RoleGate({
  allowedRoles,
  children,
  fallback = null,
}: {
  allowedRoles: Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { role } = useAuth();
  if (!role || !allowedRoles.includes(role)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
