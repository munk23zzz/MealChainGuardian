/**
 * Search helper untuk TopBar global search.
 *
 * Mengindeks tiga jenis entitas:
 *  - decisions (Recommendation) → navigasi ke /decisions/<id>
 *  - locations (Location)       → navigasi ke /dashboard?location=<id>
 *  - pages (static)             → navigasi ke path halaman
 *
 * Semua matching bersifat case-insensitive dan substring.
 */
import type { Location, Recommendation } from "./api/schema";
import { COMMODITY_LABELS, DECISION_TYPE_LABELS } from "./labels";

export type SearchResultType = "decision" | "location" | "page";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

// ---------------------------------------------------------------------------
// Static pages yang selalu muncul di hasil
// ---------------------------------------------------------------------------
const STATIC_PAGES: SearchResult[] = [
  {
    type: "page",
    id: "page-dashboard",
    title: "Dashboard",
    subtitle: "Peta pasokan & ringkasan lokasi",
    href: "/dashboard",
  },
  {
    type: "page",
    id: "page-decisions",
    title: "Keputusan",
    subtitle: "Daftar rekomendasi & persetujuan",
    href: "/decisions",
  },
  {
    type: "page",
    id: "page-agent-log",
    title: "Agent Log",
    subtitle: "Timeline aktivitas agen",
    href: "/agent-log",
  },
  {
    type: "page",
    id: "page-kpi",
    title: "KPI",
    subtitle: "Indikator kinerja utama",
    href: "/kpi",
  },
];

// ---------------------------------------------------------------------------
// Status label (lokal — tidak import dari lib lain supaya tetap pure)
// ---------------------------------------------------------------------------
const STATUS_LABELS: Record<string, string> = {
  proposed: "Diusulkan",
  verifier_flagged: "Ditandai Verifier",
  pending_approval: "Menunggu Persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
  executed: "Dilaksanakan",
};

// ---------------------------------------------------------------------------
// Builder hasil per tipe
// ---------------------------------------------------------------------------

function decisionResults(decisions: Recommendation[]): SearchResult[] {
  return decisions.map((d) => {
    const commodity =
      COMMODITY_LABELS[d.commodityId] ?? d.commodityId;
    const decisionType =
      DECISION_TYPE_LABELS[d.decisionType] ?? d.decisionType;
    const status = STATUS_LABELS[d.status] ?? d.status;
    return {
      type: "decision" as const,
      id: d.id,
      title: `${commodity} — ${decisionType}`,
      subtitle: `${status} · ${d.id}`,
      href: `/decisions/${d.id}`,
    };
  });
}

function locationResults(locations: Location[]): SearchResult[] {
  return locations.map((l) => ({
    type: "location" as const,
    id: l.id,
    title: l.name,
    subtitle: l.region,
    href: `/dashboard?location=${l.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

export function searchAll(
  query: string,
  decisions: Recommendation[],
  locations: Location[],
  maxResults = 8,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches = (text: string) => text.toLowerCase().includes(q);

  // Pages
  const pageHits = STATIC_PAGES.filter(
    (p) => matches(p.title) || matches(p.subtitle),
  );

  // Decisions — cari di id, reason, commodityId, decisionType, status
  const decHits = decisionResults(decisions).filter(
    (r, i) =>
      matches(r.title) ||
      matches(r.subtitle) ||
      matches(decisions[i]?.reason ?? "") ||
      matches(decisions[i]?.id ?? ""),
  );

  // Locations — cari di name, region
  const locHits = locationResults(locations).filter(
    (r) => matches(r.title) || matches(r.subtitle),
  );

  // Gabung: pages dulu, lalu keputusan, lalu lokasi
  return [...pageHits, ...decHits, ...locHits].slice(0, maxResults);
}
