import { describe, expect, it } from "vitest";
import {
  agentScorecard,
  agreementTone,
  ccpTone,
  fallbackTone,
  formatRate,
  overrideTone,
  scorecardTones,
  type AgentRun,
} from "@/lib/quality";

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: "r1",
  steps: 8,
  fallbacks: 0,
  verifierAgreement: "agree",
  decisionsApproved: 3,
  decisionsOverridden: 0,
  ccpCompliant: true,
  ...over,
});

describe("agentScorecard", () => {
  it("menghitung tingkat fallback dari total langkah", () => {
    const card = agentScorecard([
      run({ steps: 8, fallbacks: 1 }),
      run({ id: "r2", steps: 12, fallbacks: 3 }),
    ]);
    expect(card.totalSteps).toBe(20);
    expect(card.fallbackRate).toBeCloseTo(0.2);
  });

  it("tingkat kesesuaian mengabaikan verifier yang tidak tersedia", () => {
    const card = agentScorecard([
      run({ verifierAgreement: "agree" }),
      run({ id: "r2", verifierAgreement: "disagree" }),
      run({ id: "r3", verifierAgreement: "unavailable" }),
    ]);
    expect(card.agreementRate).toBeCloseTo(0.5);
  });

  it("tingkat override dihitung terhadap keputusan yang disetujui + diubah manusia", () => {
    const card = agentScorecard([
      run({ decisionsApproved: 8, decisionsOverridden: 2 }),
    ]);
    expect(card.overrideRate).toBeCloseTo(0.2);
  });

  it("kepatuhan CCP dihitung per run", () => {
    const card = agentScorecard([
      run(),
      run({ id: "r2", ccpCompliant: false }),
      run({ id: "r3", ccpCompliant: true }),
    ]);
    expect(card.ccpComplianceRate).toBeCloseTo(2 / 3);
  });

  it("daftar kosong tidak menghasilkan NaN", () => {
    const card = agentScorecard([]);
    expect(card).toMatchObject({
      runs: 0,
      totalSteps: 0,
      fallbackRate: 0,
      agreementRate: 0,
      overrideRate: 0,
      ccpComplianceRate: 0,
      tone: "danger", // belum ada bukti apa pun = perlu perhatian
    });
  });

  it("tone naik saat ada penyimpangan nyata", () => {
    expect(agentScorecard([run()]).tone).toBe("safe");
    expect(agentScorecard([run({ fallbacks: 2 })]).tone).toBe("warning");
    expect(agentScorecard([run({ ccpCompliant: false })]).tone).toBe("danger");
    expect(agentScorecard([run({ decisionsApproved: 1, decisionsOverridden: 1 })]).tone).toBe(
      "danger",
    );
  });
});

describe("formatRate", () => {
  it("membulatkan dan menjaga batas 0–100%", () => {
    expect(formatRate(0.826)).toBe("83%");
    expect(formatRate(0.826, 1)).toBe("82.6%");
    expect(formatRate(-1)).toBe("0%");
    expect(formatRate(3)).toBe("100%");
    expect(formatRate(Number.NaN)).toBe("0%");
  });
});

describe("tone per metrik (ambang hidup di lib, bukan di komponen)", () => {
  it("memakai ambang yang sama untuk kartu dan kesimpulan", () => {
    expect(fallbackTone(0.15)).toBe("safe");
    expect(fallbackTone(0.16)).toBe("warning");
    expect(overrideTone(0.1)).toBe("safe");
    expect(overrideTone(0.11)).toBe("warning");
    expect(overrideTone(0.26)).toBe("danger");
    expect(ccpTone(0.9)).toBe("safe");
    expect(ccpTone(0.89)).toBe("danger");
    expect(agreementTone(1)).toBe("safe");
    expect(agreementTone(0.9)).toBe("warning");
  });

  it("scorecardTones menurunkan tone tiap kartu dari satu perhitungan", () => {
    const scorecard = agentScorecard([
      run({
        id: "a",
        steps: 10,
        fallbacks: 4,
        ccpCompliant: true,
        verifierAgreement: "agree",
        decisionsApproved: 1,
        decisionsOverridden: 0,
      }),
      run({
        id: "b",
        steps: 10,
        fallbacks: 0,
        ccpCompliant: false,
        verifierAgreement: "disagree",
        decisionsApproved: 1,
        decisionsOverridden: 0,
      }),
    ]);

    const tones = scorecardTones(scorecard);
    expect(tones.fallback).toBe("warning"); // 4/20 langkah = 20% (> ambang 15%)
    expect(tones.agreement).toBe("warning"); // 1 dari 2 setuju
    expect(tones.override).toBe("safe"); // tidak ada override
    expect(tones.ccp).toBe("danger"); // 1 dari 2 run gagal CCP
    // Kesimpulan keseluruhan harus konsisten dengan kartu (CCP gagal = bahaya).
    expect(scorecard.tone).toBe("danger");
  });
});
