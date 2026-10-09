import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  SOURCES,
  hasVerifiableLink,
  sourceById,
  sourcesByConfidence,
} from "@/lib/sources";

describe("registri sumber", () => {
  it("id unik", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("setiap sumber punya label dan nilai", () => {
    expect(SOURCES.every((s) => s.label.length > 0 && s.value.length > 0)).toBe(true);
  });

  it("semua sumber yang mengklaim resmi/media/turunan punya tautan", () => {
    for (const entry of SOURCES) {
      expect(hasVerifiableLink(entry), `${entry.id} tanpa tautan`).toBe(true);
    }
  });

  it("angka yang tidak pasti ditandai apa adanya (media/turunan), bukan resmi", () => {
    expect(sourceById("jppi-korban")?.confidence).toBe("media");
    expect(sourceById("turunan-1-persen")?.confidence).toBe("turunan");
    expect(sourceById("porsi-harian")?.confidence).toBe("media");
  });

  it("data mock diakui sebagai simulasi", () => {
    expect(sourceById("mock-decisions")?.confidence).toBe("simulasi");
  });
});

describe("label & tone", () => {
  it("memetakan keyakinan ke label bahasa manusia", () => {
    expect(CONFIDENCE_LABELS.resmi).toBe("Resmi");
    expect(CONFIDENCE_LABELS.turunan).toContain("Turunan");
    expect(CONFIDENCE_LABELS.simulasi).toBe("Data simulasi");
  });

  it("warna status hanya untuk makna, simulasi netral", () => {
    expect(CONFIDENCE_TONES.resmi).toBe("safe");
    expect(CONFIDENCE_TONES.media).toBe("warning");
    expect(CONFIDENCE_TONES.simulasi).toBe("neutral");
  });
});

describe("sourcesByConfidence", () => {
  it("mengelompokkan dalam urutan tetap dan membuang grup kosong", () => {
    const groups = sourcesByConfidence();
    expect(groups[0].confidence).toBe("resmi");
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.map((g) => g.confidence)).toEqual(["resmi", "media", "turunan", "simulasi"]);
  });

  it("bisa dipakai untuk daftar yang dipangkas", () => {
    const groups = sourcesByConfidence([SOURCES[0]]);
    expect(groups).toHaveLength(1);
    expect(groups[0].confidence).toBe("resmi");
  });
});
