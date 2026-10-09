/**
 * Ekspor laporan (CSV) — murni & bisa diuji. Laporan kepatuhan dipakai untuk
 * audit internal/Dinas, jadi formatnya harus stabil dan aman dibuka di Excel:
 * pemisah koma, kutip ganda di-escape, baris CRLF, dan opsional BOM UTF-8.
 */

export type ExportColumn<T> = {
  key: keyof T & string;
  header: string;
};

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExportColumn<T>[],
): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(row[column.key])).join(","),
  );
  return [header, ...body].join("\r\n");
}

export type ReportInput<T extends Record<string, unknown>> = {
  title: string;
  generatedAt: number;
  columns: ExportColumn<T>[];
  rows: T[];
  notes?: string[];
  includeBom?: boolean;
};

/**
 * Laporan dengan kepala berkas: judul, waktu dibuat, catatan (mis. sumber &
 * asumsi), lalu tabel. Kepala berkas penting supaya angka tidak dilepas dari
 * konteksnya saat diforward lewat WhatsApp/email.
 */
export function buildReport<T extends Record<string, unknown>>(
  input: ReportInput<T>,
): string {
  const lines: string[] = [];
  lines.push(escapeCell(input.title));
  lines.push(escapeCell(`Dibuat: ${new Date(input.generatedAt).toISOString()}`));
  for (const note of input.notes ?? []) {
    lines.push(escapeCell(note));
  }
  lines.push("");
  const csv = toCsv(input.rows, input.columns);
  const body = `${lines.join("\r\n")}\r\n${csv}`;
  return input.includeBom ? `\uFEFF${body}` : body;
}

export function reportFileName(prefix: string, generatedAt: number): string {
  const date = new Date(generatedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${prefix}-${stamp}.csv`;
}
