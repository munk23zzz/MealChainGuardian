/**
 * Derivasi status lokasi (pure functions) — untuk pewarnaan marker peta dan
 * notifikasi. Frontend TIDAK menghitung angka pasokan; hanya menurunkan status
 * tampilan dari data yang sudah diberi backend.
 */
import type { SupplyRecord, LocationStatus } from "./api/schema";

const CRITICAL_SEVERITY = 2;
const WARNING_SEVERITY = 1;
const OK_SEVERITY = 0;

function severityOf(record: SupplyRecord): number {
  if (record.safetyStatus === "FAIL" || record.temperatureExcursion) {
    return CRITICAL_SEVERITY;
  }
  if (
    record.status === "deficit" ||
    record.freshnessStatus === "approaching_expiry" ||
    record.freshnessStatus === "expired" ||
    record.safetyStatus === "NEEDS_VERIFICATION"
  ) {
    return WARNING_SEVERITY;
  }
  return OK_SEVERITY;
}

/** Status agregat sebuah lokasi = tingkat keparahan tertinggi dari supply-nya. */
export function deriveLocationStatus(
  supplies: SupplyRecord[],
): LocationStatus {
  const worst = supplies.reduce(
    (max, record) => Math.max(max, severityOf(record)),
    OK_SEVERITY,
  );
  if (worst >= CRITICAL_SEVERITY) return "critical";
  if (worst >= WARNING_SEVERITY) return "warning";
  return "ok";
}

/** Pisahkan record supply menjadi kelompok surplus vs deficit. */
export function splitSurplusDeficit(supplies: SupplyRecord[]): {
  surplus: SupplyRecord[];
  deficit: SupplyRecord[];
} {
  return {
    surplus: supplies.filter((s) => s.status === "surplus"),
    deficit: supplies.filter((s) => s.status === "deficit"),
  };
}
