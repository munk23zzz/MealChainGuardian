import { describe, expect, it } from "vitest";
import {
  CRITICAL_REMAINING_MS,
  SAFE_WINDOW_MS,
  WARNING_REMAINING_MS,
  formatRemaining,
  planDelivery,
  serveWindow,
  windowTone,
} from "@/lib/four-hour";

const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = 1_700_000_000_000; // "waktu matang"

describe("windowTone", () => {
  it("danger saat lewat batas atau di bawah 30 menit", () => {
    expect(windowTone(-1, true)).toBe("danger");
    expect(windowTone(0, true)).toBe("danger");
    expect(windowTone(CRITICAL_REMAINING_MS - 1, false)).toBe("danger");
    expect(windowTone(CRITICAL_REMAINING_MS, false)).toBe("danger");
  });

  it("warning pada satu jam terakhir", () => {
    expect(windowTone(WARNING_REMAINING_MS, false)).toBe("warning");
    expect(windowTone(CRITICAL_REMAINING_MS + 1, false)).toBe("warning");
  });

  it("safe bila masih banyak waktu", () => {
    expect(windowTone(WARNING_REMAINING_MS + 1, false)).toBe("safe");
    expect(windowTone(4 * HOUR, false)).toBe("safe");
  });
});

describe("serveWindow", () => {
  it("menghitung sisa, kedaluwarsa, dan persentase", () => {
    const twoHoursIn = serveWindow(T0, T0 + 2 * HOUR);
    expect(twoHoursIn.remainingMs).toBe(2 * HOUR);
    expect(twoHoursIn.elapsedMs).toBe(2 * HOUR);
    expect(twoHoursIn.expired).toBe(false);
    expect(twoHoursIn.percentElapsed).toBe(50);
    expect(twoHoursIn.tone).toBe("safe");
  });

  it("deadline tepat 4 jam setelah matang", () => {
    const window = serveWindow(T0, T0 + 30 * MIN);
    expect(window.deadline).toBe(T0 + SAFE_WINDOW_MS);
    expect(window.remainingMs).toBe(SAFE_WINDOW_MS - 30 * MIN);
  });

  it("lewat batas: expired, tone danger, persentase mentok 100", () => {
    const late = serveWindow(T0, T0 + 5 * HOUR);
    expect(late.expired).toBe(true);
    expect(late.tone).toBe("danger");
    expect(late.percentElapsed).toBe(100);
    expect(late.remainingMs).toBe(-HOUR);
  });

  it("jam mundur (now < cookedAt) tidak menghasilkan angka negatif", () => {
    const odd = serveWindow(T0, T0 - HOUR);
    expect(odd.elapsedMs).toBe(0);
    expect(odd.percentElapsed).toBe(0);
    expect(odd.tone).toBe("safe");
  });
});

describe("formatRemaining", () => {
  it("jam + menit untuk sisa besar", () => {
    expect(formatRemaining(3 * HOUR + 42 * MIN)).toBe("3 jam 42 menit lagi");
  });

  it("hanya menit untuk sisa kecil", () => {
    expect(formatRemaining(18 * MIN)).toBe("18 menit lagi");
  });

  it("menyebut keterlambatan saat sudah lewat", () => {
    expect(formatRemaining(-12 * MIN)).toBe("lewat 12 menit");
  });
});

describe("planDelivery", () => {
  it("tiba sebelum batas 4 jam", () => {
    const plan = planDelivery(T0, T0 + 2 * HOUR, 45);
    expect(plan.withinWindow).toBe(true);
    expect(plan.remainingOnArrivalMs).toBe(75 * MIN);
    expect(plan.tone).toBe("safe");
  });

  it("tiba di menit-menit kritis", () => {
    const plan = planDelivery(T0, T0 + 3 * HOUR + 40 * MIN, 15);
    expect(plan.withinWindow).toBe(true);
    expect(plan.tone).toBe("danger");
  });

  it("perjalanan terlalu lama = tidak layak dikirim", () => {
    const plan = planDelivery(T0, T0 + 3 * HOUR, 90);
    expect(plan.withinWindow).toBe(false);
    expect(plan.tone).toBe("danger");
  });
});
