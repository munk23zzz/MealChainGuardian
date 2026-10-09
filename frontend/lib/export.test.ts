import { describe, expect, it } from "vitest";
import { buildReport, reportFileName, toCsv, type ExportColumn } from "@/lib/export";

type Row = { rule: string; value: number; note?: string };

const columns: ExportColumn<Row>[] = [
  { key: "rule", header: "Titik kendali" },
  { key: "value", header: "Nilai" },
  { key: "note", header: "Catatan" },
];

describe("toCsv", () => {
  it("menulis kepala kolom lalu baris data dengan CRLF", () => {
    const csv = toCsv([{ rule: "chiller", value: 3 }], columns);
    expect(csv).toBe("Titik kendali,Nilai,Catatan\r\nchiller,3,");
  });

  it("mengutip sel yang memuat koma, tanda kutip, atau baris baru", () => {
    const csv = toCsv(
      [{ rule: 'suhu, "dingin"', value: 4, note: "baris1\nbaris2" }],
      columns,
    );
    expect(csv).toContain('"suhu, ""dingin"""');
    expect(csv).toContain('"baris1\nbaris2"');
  });

  it("nilai kosong tetap menghasilkan kolom kosong (bukan 'undefined')", () => {
    expect(toCsv([{ rule: "x", value: 1 }], columns).endsWith("x,1,")).toBe(true);
  });

  it("daftar kosong tetap menulis kepala kolom", () => {
    expect(toCsv([], columns)).toBe("Titik kendali,Nilai,Catatan");
  });

  it("aman terhadap karakter pemisah titik koma (Excel regional)", () => {
    expect(toCsv([{ rule: "a;b", value: 1 }], columns)).toContain('"a;b"');
  });
});

describe("buildReport", () => {
  const rows: Row[] = [{ rule: "chiller", value: 3, note: "sesuai" }];

  it("menyertakan judul, waktu, dan catatan sebelum tabel", () => {
    const report = buildReport({
      title: "Papan Bukti CCP",
      generatedAt: Date.UTC(2026, 9, 7, 3, 30),
      columns,
      rows,
      notes: ["Sumber: Kemenkes — higiene sanitasi pangan"],
    });
    const [title, generated, note] = report.split("\r\n");
    expect(title).toBe("Papan Bukti CCP");
    expect(generated).toContain("2026-10-07");
    expect(note).toContain("Kemenkes");
    expect(report).toContain("chiller,3,sesuai");
  });

  it("BOM opsional (untuk Excel) dan tidak mengubah kolom", () => {
    const withBom = buildReport({ title: "T", generatedAt: 0, columns, rows, includeBom: true });
    expect(withBom.startsWith("\uFEFF")).toBe(true);
    const without = buildReport({ title: "T", generatedAt: 0, columns, rows });
    expect(without.startsWith("\uFEFF")).toBe(false);
  });
});

describe("reportFileName", () => {
  it("memakai cap waktu yang bisa diurutkan", () => {
    const name = reportFileName("ccp", new Date(2026, 9, 7, 9, 5).getTime());
    expect(name).toBe("ccp-20261007-0905.csv");
  });
});
