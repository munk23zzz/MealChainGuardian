import { describe, expect, it } from "vitest";
import {
  QUEUE_LIMIT,
  createQueuedAction,
  deserializeQueue,
  enqueue,
  formatQueueLabel,
  markSent,
  pendingCount,
  serializeQueue,
  type QueuedAction,
} from "@/lib/offline-queue";

const sample = (id: string, now = 1_000): QueuedAction =>
  createQueuedAction({ kind: "receiving_inspection", label: `Kiriman ${id}`, payload: { id } }, now, id);

describe("enqueue", () => {
  it("menaruh yang terbaru di depan", () => {
    const list = enqueue(enqueue([], sample("a", 1)), sample("b", 2));
    expect(list.map((a) => a.id)).toEqual(["b", "a"]);
  });

  it("memotong pada QUEUE_LIMIT", () => {
    let list: QueuedAction[] = [];
    for (let i = 0; i < QUEUE_LIMIT + 5; i += 1) list = enqueue(list, sample(`a${i}`, i));
    expect(list).toHaveLength(QUEUE_LIMIT);
  });

  it("aksi baru selalu pending dengan 0 percobaan", () => {
    const action = sample("a");
    expect(action.status).toBe("pending");
    expect(action.attempts).toBe(0);
  });
});

describe("markSent / pendingCount", () => {
  it("menandai terkirim dan menghitung sisa", () => {
    const list = [sample("a"), sample("b")];
    expect(pendingCount(list)).toBe(2);
    const after = markSent(list, "a");
    expect(pendingCount(after)).toBe(1);
    expect(after.find((a) => a.id === "a")?.attempts).toBe(1);
    expect(markSent(list, "zzz")).toHaveLength(2);
  });
});

describe("serialisasi", () => {
  it("bolak-balik utuh", () => {
    const list = [sample("a"), sample("b")];
    expect(deserializeQueue(serializeQueue(list))).toEqual(list);
  });

  it("toleran terhadap null, JSON rusak, dan bentuk salah", () => {
    expect(deserializeQueue(null)).toEqual([]);
    expect(deserializeQueue("bukan json")).toEqual([]);
    expect(deserializeQueue('{"a":1}')).toEqual([]);
    expect(deserializeQueue('[{"id":1},{"id":"ok","label":"x","createdAt":1,"attempts":0,"status":"pending","kind":"receiving_inspection"}]')).toHaveLength(1);
  });

  it("membuang entri dengan kind tak dikenal (versi lama)", () => {
    const alien = JSON.stringify([
      { id: "x", label: "x", createdAt: 1, attempts: 0, status: "pending", kind: "teleport" },
    ]);
    expect(deserializeQueue(alien)).toEqual([]);
  });
});

describe("formatQueueLabel", () => {
  it("menjelaskan keadaan antrean", () => {
    expect(formatQueueLabel([])).toBe("Semua aksi terkirim");
    expect(formatQueueLabel([sample("a")])).toBe("1 aksi menunggu dikirim");
    expect(formatQueueLabel([sample("a"), sample("b")])).toBe("2 aksi menunggu dikirim");
    expect(formatQueueLabel([{ ...sample("a"), status: "sent" }])).toBe("Semua aksi terkirim");
  });
});
