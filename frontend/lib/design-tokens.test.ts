import { describe, it, expect } from "vitest";
import {
  PALETTE,
  toneColor,
  toneClasses,
  locationStatusColor,
  locationStatusLabel,
  safetyStatusColor,
  safetyStatusLabel,
  decisionStatusColor,
  decisionStatusLabel,
  normalizeDecisionStatus,
  supplyStatusTone,
  type Tone,
} from "./design-tokens";

/**
 * Test ini adalah penjaga design.md §4 — kalau ada yang "merapikan" token warna
 * tanpa mengubah dokumen, test ini merah. Palet di sini TIDAK boleh diganti
 * tanpa alasan kuat (design.md §4: "konsisten dengan proposal").
 */
describe("PALETTE (design.md §4)", () => {
  it("persis sama dengan token di docs/design.md", () => {
    expect(PALETTE).toEqual({
      navy900: "#1F3B4D",
      navy700: "#2E5266",
      navy100: "#DCE6E9",
      grey500: "#555555",
      statusSafe: "#2E7D32",
      statusWarning: "#F9A825",
      statusDanger: "#C62828",
    });
  });
});

describe("toneColor", () => {
  it("memetakan tiap tone ke warna palet (tanpa warna di luar design.md)", () => {
    const paletteValues = Object.values(PALETTE) as string[];
    const tones: Tone[] = ["safe", "warning", "danger", "info", "neutral"];
    for (const tone of tones) {
      expect(paletteValues).toContain(toneColor(tone));
    }
  });

  it("safe/warning/danger pakai token status, info pakai navy-700, neutral pakai grey-500", () => {
    expect(toneColor("safe")).toBe(PALETTE.statusSafe);
    expect(toneColor("warning")).toBe(PALETTE.statusWarning);
    expect(toneColor("danger")).toBe(PALETTE.statusDanger);
    expect(toneColor("info")).toBe(PALETTE.navy700);
    expect(toneColor("neutral")).toBe(PALETTE.grey500);
  });
});

describe("toneClasses (badge)", () => {
  it("memakai token Tailwind hasil pemetaan design.md, bukan warna bawaan Tailwind", () => {
    expect(toneClasses("safe")).toContain("status-safe");
    expect(toneClasses("danger")).toContain("status-danger");
    expect(toneClasses("info")).toContain("navy-700");
  });

  it("teks badge warning pakai navy-900 agar tetap terbaca di atas kuning", () => {
    expect(toneClasses("warning")).toContain("text-navy-900");
    expect(toneClasses("warning")).toContain("status-warning");
  });

  it("tidak menyisipkan hex mentah (token harus lewat Tailwind/JIT)", () => {
    const tones: Tone[] = ["safe", "warning", "danger", "info", "neutral"];
    for (const tone of tones) {
      expect(toneClasses(tone)).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});

describe("locationStatus", () => {
  it("ok=aman, warning=tight, critical=kritis (design.md §3.1)", () => {
    expect(locationStatusColor("ok")).toBe(PALETTE.statusSafe);
    expect(locationStatusColor("warning")).toBe(PALETTE.statusWarning);
    expect(locationStatusColor("critical")).toBe(PALETTE.statusDanger);
  });

  it("label tidak ambigu (selalu Bahasa Indonesia yang jelas)", () => {
    expect(locationStatusLabel("ok")).toBe("Normal");
    expect(locationStatusLabel("warning")).toBe("Tight");
    expect(locationStatusLabel("critical")).toBe("Kritis");
  });
});

describe("safetyStatus (design.md §4 prinsip 2)", () => {
  it("PASS=hijau, NEEDS_VERIFICATION=kuning, FAIL=merah", () => {
    expect(safetyStatusColor("PASS")).toBe(PALETTE.statusSafe);
    expect(safetyStatusColor("NEEDS_VERIFICATION")).toBe(PALETTE.statusWarning);
    expect(safetyStatusColor("FAIL")).toBe(PALETTE.statusDanger);
  });

  it("label selalu memuat enum apa adanya, tidak ditafsirkan ulang", () => {
    expect(safetyStatusLabel("PASS")).toContain("PASS");
    expect(safetyStatusLabel("FAIL")).toContain("FAIL");
    expect(safetyStatusLabel("NEEDS_VERIFICATION")).toContain(
      "NEEDS_VERIFICATION",
    );
  });
});

describe("decisionStatus", () => {
  it("approved=aman, executed=info, pending_approval=kuning, rejected/verifier_flagged=merah", () => {
    expect(decisionStatusColor("approved")).toBe(PALETTE.statusSafe);
    expect(decisionStatusColor("executed")).toBe(PALETTE.navy700);
    expect(decisionStatusColor("pending_approval")).toBe(PALETTE.statusWarning);
    expect(decisionStatusColor("rejected")).toBe(PALETTE.statusDanger);
    expect(decisionStatusColor("verifier_flagged")).toBe(PALETTE.statusDanger);
    expect(decisionStatusColor("proposed")).toBe(PALETTE.grey500);
  });

  it("semua status dari Schema.md §3 punya label Bahasa Indonesia", () => {
    expect(decisionStatusLabel("proposed")).toBe("Diusulkan");
    expect(decisionStatusLabel("verifier_flagged")).toBe("Ditandai Verifier");
    expect(decisionStatusLabel("pending_approval")).toBe("Menunggu approval");
    expect(decisionStatusLabel("approved")).toBe("Disetujui");
    expect(decisionStatusLabel("rejected")).toBe("Ditolak");
    expect(decisionStatusLabel("executed")).toBe("Dieksekusi");
  });
});

describe("normalizeDecisionStatus", () => {
  it("menormalkan status lama frontend (pending_review) ke enum Schema.md", () => {
    expect(normalizeDecisionStatus("pending_review")).toBe("pending_approval");
  });

  it("meneruskan status yang sudah sesuai Schema.md", () => {
    expect(normalizeDecisionStatus("executed")).toBe("executed");
    expect(normalizeDecisionStatus("verifier_flagged")).toBe(
      "verifier_flagged",
    );
  });

  it("nilai tak dikenal jatuh ke default aman 'proposed', bukan menebak", () => {
    expect(normalizeDecisionStatus("kadang_kadang")).toBe("proposed");
    expect(normalizeDecisionStatus("")).toBe("proposed");
  });
});

describe("supplyStatusTone", () => {
  it("balanced=aman, deficit=perhatian, surplus=info", () => {
    expect(supplyStatusTone("balanced")).toBe("safe");
    expect(supplyStatusTone("deficit")).toBe("warning");
    expect(supplyStatusTone("surplus")).toBe("info");
  });
});
