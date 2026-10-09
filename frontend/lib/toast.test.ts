import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_DURATION_MS,
  TOAST_LIMIT,
  createToast,
  dismissToast,
  expireToasts,
  nextExpiryIn,
  pushToast,
  resetToastSequence,
  type Toast,
} from "@/lib/toast";

beforeEach(() => resetToastSequence());

describe("createToast", () => {
  it("memberi id berurutan dan tone default info", () => {
    const first = createToast({ title: "Tersimpan" }, 1_000);
    const second = createToast({ title: "Terkirim" }, 1_000);
    expect([first.id, second.id]).toEqual([1, 2]);
    expect(first.tone).toBe("info");
    expect(first.durationMs).toBe(DEFAULT_DURATION_MS);
  });

  it("kegagalan tidak hilang otomatis (durasi 0)", () => {
    const toast = createToast({ title: "Gagal menyetujui", tone: "danger" }, 0);
    expect(toast.durationMs).toBe(0);
    expect(expireToasts([toast], 10 ** 9)).toHaveLength(1);
  });

  it("durasi bisa ditimpa eksplisit", () => {
    expect(createToast({ title: "x", durationMs: 1_500 }, 0).durationMs).toBe(1_500);
  });
});

describe("pushToast / TOAST_LIMIT", () => {
  it("menaruh yang terbaru di depan", () => {
    const a = createToast({ title: "A" }, 1);
    const b = createToast({ title: "B" }, 2);
    const list = pushToast(pushToast([], a), b);
    expect(list.map((t) => t.title)).toEqual(["B", "A"]);
  });

  it("memotong pada batas agar tidak menutupi layar", () => {
    let list: Toast[] = [];
    for (let i = 1; i <= TOAST_LIMIT + 2; i += 1) {
      list = pushToast(list, createToast({ title: `T${i}` }, i));
    }
    expect(list).toHaveLength(TOAST_LIMIT);
    expect(list[0].title).toBe(`T${TOAST_LIMIT + 2}`);
  });
});

describe("dismissToast", () => {
  it("membuang hanya id yang diminta", () => {
    const a = createToast({ title: "A" }, 1);
    const b = createToast({ title: "B" }, 2);
    expect(dismissToast([a, b], a.id).map((t) => t.title)).toEqual(["B"]);
    expect(dismissToast([a, b], 999)).toHaveLength(2);
  });
});

describe("expireToasts", () => {
  it("membuang yang lewat durasi, menyisakan yang belum", () => {
    const old = createToast({ title: "Lama", durationMs: 1_000 }, 0);
    const fresh = createToast({ title: "Baru", durationMs: 5_000 }, 0);
    expect(expireToasts([old, fresh], 2_000).map((t) => t.title)).toEqual(["Baru"]);
  });
});

describe("nextExpiryIn", () => {
  it("null bila tidak ada toast berdurasi", () => {
    expect(nextExpiryIn([], 0)).toBeNull();
    expect(nextExpiryIn([createToast({ title: "x", tone: "danger" }, 0)], 0)).toBeNull();
  });

  it("menghitung sisa terdekat dan tidak pernah negatif", () => {
    const short = createToast({ title: "s", durationMs: 1_000 }, 0);
    const long = createToast({ title: "l", durationMs: 9_000 }, 0);
    expect(nextExpiryIn([short, long], 400)).toBe(600);
    expect(nextExpiryIn([short], 10_000)).toBe(0);
  });
});
