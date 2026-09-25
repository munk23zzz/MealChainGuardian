/**
 * Pemetaan status lokasi -> warna & label.
 *
 * Sejak design.md (docs baru) jadi source of truth, pemetaan ini HANYA delegasi
 * ke lib/design-tokens.ts. Jangan tambahkan hex di sini.
 */
import type { LocationStatus } from "./api/schema";
import {
  locationStatusColor,
  locationStatusLabel,
} from "./design-tokens";

export const STATUS_COLORS: Record<LocationStatus, string> = {
  ok: locationStatusColor("ok"),
  warning: locationStatusColor("warning"),
  critical: locationStatusColor("critical"),
};

export const STATUS_LABELS: Record<LocationStatus, string> = {
  ok: locationStatusLabel("ok"),
  warning: locationStatusLabel("warning"),
  critical: locationStatusLabel("critical"),
};

export function statusColor(status: LocationStatus): string {
  return locationStatusColor(status);
}

export function statusLabel(status: LocationStatus): string {
  return locationStatusLabel(status);
}
