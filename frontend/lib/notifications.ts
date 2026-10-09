/**
 * Notification helper — menurunkan notifikasi dari data yang sudah ada
 * (decisions + locations + supply) tanpa endpoint backend tambahan.
 *
 * Empat kategori notifikasi:
 *  - pending_approval  : keputusan menunggu persetujuan
 *  - verifier_flagged  : keputusan ditandai verifier
 *  - critical_location : lokasi berstatus critical
 *  - safety_alert      : supply dengan safetyStatus FAIL / NEEDS_VERIFICATION
 *                        atau temperatureExcursion = true
 */
import type { Location, Recommendation, SupplyRecord } from "./api/schema";

export type NotificationSeverity = "high" | "medium" | "low";
export type NotificationCategory =
  | "pending_approval"
  | "verifier_flagged"
  | "critical_location"
  | "safety_alert";

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  description: string;
  /** href yang dibuka saat notifikasi diklik. */
  href: string;
  createdAt: string;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const COMMODITY_LABELS: Record<string, string> = {
  "com-beras": "Beras",
  "com-telur": "Telur",
  "com-ayam": "Ayam",
  "com-ikan": "Ikan",
  "com-tempe": "Tempe",
  "com-tahu": "Tahu",
  "com-wortel": "Wortel",
  "com-bayam": "Bayam",
  "com-pisang": "Pisang",
};

function commodityLabel(id: string) {
  return COMMODITY_LABELS[id] ?? id;
}

// ---------------------------------------------------------------------------
// Builders per kategori
// ---------------------------------------------------------------------------

function pendingApprovalNotifs(
  decisions: Recommendation[],
): NotificationItem[] {
  return decisions
    .filter((d) => d.status === "pending_approval")
    .map((d) => ({
      id: `notif-pending-${d.id}`,
      category: "pending_approval" as const,
      severity: "high" as const,
      title: `Persetujuan diperlukan`,
      description: `Keputusan ${commodityLabel(d.commodityId)} (${d.id}) menunggu persetujuan Anda.`,
      href: `/decisions/${d.id}`,
      createdAt: d.createdAt,
      read: false,
    }));
}

function verifierFlaggedNotifs(
  decisions: Recommendation[],
): NotificationItem[] {
  return decisions
    .filter((d) => d.status === "verifier_flagged")
    .map((d) => ({
      id: `notif-flagged-${d.id}`,
      category: "verifier_flagged" as const,
      severity: "high" as const,
      title: `Ditandai Verifier`,
      description:
        d.verifierNote
          ? `${commodityLabel(d.commodityId)}: "${d.verifierNote}"`
          : `Keputusan ${d.id} memerlukan tinjauan ulang.`,
      href: `/decisions/${d.id}`,
      createdAt: d.createdAt,
      read: false,
    }));
}

function criticalLocationNotifs(locations: Location[]): NotificationItem[] {
  return locations
    .filter((l) => l.status === "critical")
    .map((l) => ({
      id: `notif-critical-${l.id}`,
      category: "critical_location" as const,
      severity: "high" as const,
      title: `Lokasi Kritis`,
      description: `${l.name} (${l.region}) berstatus kritis — stok kritis terdeteksi.`,
      href: `/dashboard?location=${l.id}`,
      createdAt: new Date().toISOString(),
      read: false,
    }));
}

function safetyAlertNotifs(supply: SupplyRecord[]): NotificationItem[] {
  return supply
    .filter(
      (s) =>
        s.safetyStatus === "FAIL" ||
        s.safetyStatus === "NEEDS_VERIFICATION" ||
        s.temperatureExcursion === true,
    )
    .map((s) => {
      const isFailure = s.safetyStatus === "FAIL";
      const isTempExcursion = s.temperatureExcursion === true;
      const label = commodityLabel(s.commodityId);

      const title = isFailure
        ? `Keamanan Pangan GAGAL`
        : isTempExcursion
          ? `Penyimpangan Suhu Terdeteksi`
          : `Verifikasi Keamanan Diperlukan`;

      const description = isFailure
        ? `${label} di ${s.locationId} tidak lulus pemeriksaan keamanan.`
        : isTempExcursion
          ? `${label} di ${s.locationId} mengalami penyimpangan suhu rantai dingin.`
          : `${label} di ${s.locationId} perlu verifikasi keamanan pangan.`;

      return {
        id: `notif-safety-${s.locationId}-${s.commodityId}`,
        category: "safety_alert" as const,
        severity: isFailure ? ("high" as const) : ("medium" as const),
        title,
        description,
        href: `/dashboard?location=${s.locationId}`,
        createdAt: new Date().toISOString(),
        read: false,
      };
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Hasilkan semua notifikasi dari data saat ini, diurutkan severity tertinggi dulu. */
export function deriveNotifications(
  decisions: Recommendation[],
  locations: Location[],
  supply: SupplyRecord[],
): NotificationItem[] {
  const all = [
    ...pendingApprovalNotifs(decisions),
    ...verifierFlaggedNotifs(decisions),
    ...criticalLocationNotifs(locations),
    ...safetyAlertNotifs(supply),
  ];

  // Severity order: high → medium → low
  const order: Record<NotificationSeverity, number> = { high: 0, medium: 1, low: 2 };
  return all.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function unreadCount(notifications: NotificationItem[]): number {
  return notifications.filter((n) => !n.read).length;
}
