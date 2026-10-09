import { describe, expect, it } from "vitest";
import {
  DEMO_STEPS,
  demoHref,
  nextStep,
  parseDemoQuery,
  previousStep,
  stepAt,
} from "@/lib/demo";

describe("skenario demo", () => {
  it("lima langkah berurutan dengan sumber yang disebut", () => {
    expect(DEMO_STEPS).toHaveLength(5);
    expect(DEMO_STEPS.every((s) => s.source.length > 0)).toBe(true);
    expect(DEMO_STEPS.map((s) => s.clock)).toEqual(["04:30", "09:00", "10:15", "11:00", "14:00"]);
  });

  it("id unik", () => {
    expect(new Set(DEMO_STEPS.map((s) => s.id)).size).toBe(5);
  });
});

describe("navigasi langkah", () => {
  it("tidak keluar batas", () => {
    expect(previousStep(0)).toBe(0);
    expect(nextStep(DEMO_STEPS.length - 1)).toBe(DEMO_STEPS.length - 1);
    expect(nextStep(0)).toBe(1);
    expect(previousStep(2)).toBe(1);
  });

  it("stepAt mengembalikan null di luar rentang", () => {
    expect(stepAt(0)?.clock).toBe("04:30");
    expect(stepAt(99)).toBeNull();
    expect(stepAt(-1)).toBeNull();
  });

  it("demoHref membentuk tautan yang bisa dibuka", () => {
    expect(demoHref(2)).toBe("/dashboard?demo=1&step=2");
  });
});

describe("parseDemoQuery", () => {
  it("mengenali ?demo=1", () => {
    expect(parseDemoQuery("?demo=1")).toEqual({ enabled: true, step: 0 });
    expect(parseDemoQuery("?demo=true&step=3")).toEqual({ enabled: true, step: 3 });
    expect(parseDemoQuery("demo=1&step=1")).toEqual({ enabled: true, step: 1 });
  });

  it("mati bila tidak diminta", () => {
    expect(parseDemoQuery("")).toEqual({ enabled: false, step: 0 });
    expect(parseDemoQuery("?demo=0")).toEqual({ enabled: false, step: 0 });
    expect(parseDemoQuery("?x=1")).toEqual({ enabled: false, step: 0 });
  });

  it("step tidak sah dikembalikan ke 0 (tidak melempar error)", () => {
    expect(parseDemoQuery("?demo=1&step=99").step).toBe(0);
    expect(parseDemoQuery("?demo=1&step=-2").step).toBe(0);
    expect(parseDemoQuery("?demo=1&step=abc").step).toBe(0);
  });
});
