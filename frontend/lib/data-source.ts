/**
 * Penandaan sumber data (Rules.md §1.4 / workflows.md §6.4).
 *
 * Semua angka yang berasal dari mock SAP WAJIB tampil dengan badge di UI —
 * demo tidak boleh terlihat mengklaim data SAP asli padahal simulasi.
 */
export const DATA_SOURCE_HEADER = "X-Data-Source";

export type DataSource = "MOCK" | "LIVE";

const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  MOCK: "Data Simulasi",
  LIVE: "SAP (live)",
};

export function dataSourceLabel(source: DataSource): string {
  return DATA_SOURCE_LABELS[source];
}

/** Badge hanya untuk data mock — data live tidak perlu ditandai. */
export function shouldShowDataSourceBadge(source: DataSource): boolean {
  return source === "MOCK";
}

/** Mode mock aktif hanya kalau env var persis "true". */
export function isMockMode(envValue: string | undefined): boolean {
  return envValue === "true";
}

/** Sumber data efektif untuk sesi berjalan. */
export function currentDataSource(envValue: string | undefined): DataSource {
  return isMockMode(envValue) ? "MOCK" : "LIVE";
}
