import { describe, expect, it } from "vitest";
import {
  CCP_RULES,
  DANGER_ZONE,
  evaluateCcp,
  ruleById,
  summarizeCcp,
  type CcpEvaluation,
} from "@/lib/ccp";

const rule = (id: string) => {
  const found = ruleById(id);
  if (!found) throw new Error(`aturan ${id} tidak ada`);
  return found;
};

describe("katalog aturan", () => {
  it("id unik dan sumber tercatat", () => {
    const ids = CCP_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CCP_RULES.every((r) => r.source.length > 0)).toBe(true);
  });

  it("memuat ambang kunci dari sumber resmi", () => {
    expect(rule("chilled").max).toBe(4);
    expect(rule("frozen").max).toBe(-18);
    expect(rule("hot-hold").min).toBe(60);
    expect(rule("cook-to-serve").max).toBe(4);
    expect(DANGER_ZONE).toEqual({ min: 5, max: 60 });
  });
});

describe("evaluateCcp — batas atas", () => {
  it("chiller 3 °C sesuai, 5 °C mendekati batas, 7 °C gagal", () => {
    expect(evaluateCcp(rule("chilled"), 3).status).toBe("pass");
    expect(evaluateCcp(rule("chilled"), 4).status).toBe("pass");
    expect(evaluateCcp(rule("chilled"), 5).status).toBe("warn");
    expect(evaluateCcp(rule("chilled"), 7).status).toBe("fail");
  });

  it("freezer: -19 sesuai, -17 mendekati, -15 gagal", () => {
    expect(evaluateCcp(rule("frozen"), -19).status).toBe("pass");
    expect(evaluateCcp(rule("frozen"), -17).status).toBe("warn");
    expect(evaluateCcp(rule("frozen"), -15).status).toBe("fail");
  });

  it("waktu masak→konsumsi 3,5 jam sesuai, 4,4 jam mendekati, 6 jam gagal", () => {
    expect(evaluateCcp(rule("cook-to-serve"), 3.5).status).toBe("pass");
    expect(evaluateCcp(rule("cook-to-serve"), 4.4).status).toBe("warn");
    expect(evaluateCcp(rule("cook-to-serve"), 6).status).toBe("fail");
  });
});

describe("evaluateCcp — batas bawah", () => {
  it("pangan panas 65 °C sesuai, 59 °C mendekati, 50 °C gagal", () => {
    expect(evaluateCcp(rule("hot-hold"), 65).status).toBe("pass");
    expect(evaluateCcp(rule("hot-hold"), 59).status).toBe("warn");
    expect(evaluateCcp(rule("hot-hold"), 50).status).toBe("fail");
  });
});

describe("evaluateCcp — rentang", () => {
  it("thawing 8,5 jam sesuai; 7 jam mendekati; 3 jam gagal", () => {
    expect(evaluateCcp(rule("thawing"), 8.5).status).toBe("pass");
    expect(evaluateCcp(rule("thawing"), 7).status).toBe("warn");
    expect(evaluateCcp(rule("thawing"), 3).status).toBe("fail");
  });

  it("zona bahaya: 30 °C (di dalam zona) GAGAL, 0 °C aman, 4 °C mendekati", () => {
    // Aturan ini "invert": yang diukur adalah suhu pangan, jadi berada di dalam
    // rentang 5–60 °C justru berarti gagal — bukan lulus.
    expect(evaluateCcp(rule("danger-zone"), 30).status).toBe("fail");
    expect(evaluateCcp(rule("danger-zone"), 4).status).toBe("warn");
    expect(evaluateCcp(rule("danger-zone"), 0).status).toBe("pass");
    expect(evaluateCcp(rule("danger-zone"), 30).message).toContain("zona bahaya");
  });
});

describe("evaluateCcp — data kosong", () => {
  it("belum diukur TIDAK pernah dianggap aman", () => {
    for (const value of [null, undefined, Number.NaN]) {
      const result = evaluateCcp(rule("chilled"), value);
      expect(result.status).toBe("warn");
      expect(result.message).toContain("Belum ada pengukuran");
    }
  });

  it("tone mengikuti status", () => {
    expect(evaluateCcp(rule("chilled"), 2).tone).toBe("safe");
    expect(evaluateCcp(rule("chilled"), 5).tone).toBe("warning");
    expect(evaluateCcp(rule("chilled"), 9).tone).toBe("danger");
  });
});

describe("summarizeCcp", () => {
  const evalWith = (statuses: CcpEvaluation["status"][]): CcpEvaluation[] =>
    statuses.map((status, i) => ({
      ruleId: `r${i}`,
      status,
      tone: status === "pass" ? "safe" : status === "warn" ? "warning" : "danger",
      message: "",
    }));

  it("menghitung kepatuhan dan tone keseluruhan", () => {
    const summary = summarizeCcp(evalWith(["pass", "pass", "warn", "fail"]));
    expect(summary).toMatchObject({ total: 4, pass: 2, warn: 1, fail: 1, compliancePercent: 50 });
    expect(summary.tone).toBe("danger");
  });

  it("warning bila hanya ada penyimpangan ringan", () => {
    expect(summarizeCcp(evalWith(["pass", "warn"])).tone).toBe("warning");
  });

  it("daftar kosong tidak dianggap aman 100%", () => {
    const summary = summarizeCcp([]);
    expect(summary.compliancePercent).toBe(0);
    expect(summary.tone).toBe("safe");
    expect(summary.total).toBe(0);
  });
});
