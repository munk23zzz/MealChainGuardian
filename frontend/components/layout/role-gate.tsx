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

/**
 * Render anak hanya jika user boleh approve (canApprove === true).
 * bgn_monitor dan siapa pun dengan canApprove=false akan melihat fallback.
 */
export function ApproveGate({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canApprove } = useAuth();
  return canApprove ? <>{children}</> : <>{fallback}</>;
}
