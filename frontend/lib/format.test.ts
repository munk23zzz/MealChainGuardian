import { describe, it, expect } from "vitest";
import {
  formatRupiah,
  formatKg,
  formatPercent,
  formatScore,
  formatMinutes,
  formatDate,
  formatTime,
  formatDateTime,
  formatDurationMs,
} from "./format";

describe("formatScore", () => {
  it("memakai desimal koma (kebiasaan Indonesia)", () => {
    expect(formatScore(0.8)).toBe("0,80");
    expect(formatScore(0.62)).toBe("0,62");
    expect(formatScore(1)).toBe("1,00");
    expect(formatScore(0)).toBe("0,00");
  });

  it("menghormati jumlah digit", () => {
    expect(formatScore(0.805, 3)).toBe("0,805");
    expect(formatScore(0.8, 0)).toBe("1");
  });
});

describe("formatRupiah", () => {
  it("memformat nol", () => {
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  it("memformat ribuan dengan titik pemisah", () => {
    expect(formatRupiah(28500)).toBe("Rp 28.500");
  });

  it("memformat jutaan", () => {
    expect(formatRupiah(180000000)).toBe("Rp 180.000.000");
  });

  it("membulatkan ke rupiah terdekat (tanpa desimal)", () => {
    expect(formatRupiah(28500.6)).toBe("Rp 28.501");
  });
});

describe("formatKg", () => {
  it("memformat kilogram bulat", () => {
    expect(formatKg(1500)).toBe("1.500 kg");
  });

  it("memformat kilogram dengan desimal", () => {
    expect(formatKg(1234.5)).toBe("1.234,5 kg");
  });
});

describe("formatPercent", () => {
  it("memformat persen bulat", () => {
    expect(formatPercent(85)).toBe("85%");
  });

  it("memformat persen dengan satu desimal", () => {
    expect(formatPercent(4.5)).toBe("4,5%");
  });
});

describe("formatMinutes", () => {
  it("memformat di bawah satu menit", () => {
    expect(formatMinutes(0.5)).toBe("0,5 menit");
  });

  it("memformat menit bulat", () => {
    expect(formatMinutes(4)).toBe("4 menit");
  });

  it("memformat jam", () => {
    expect(formatMinutes(120)).toBe("2 jam");
  });
});

describe("formatDate", () => {
  it("memformat tanggal ISO ke format Indonesia", () => {
    expect(formatDate("2026-09-01T08:00:00Z")).toBe("1 Sep 2026");
  });

  it("mengembalikan string asli untuk input tidak valid", () => {
    expect(formatDate("bukan-tanggal")).toBe("bukan-tanggal");
  });
});

describe("formatTime (WIB)", () => {
  it("menampilkan waktu dalam WIB (UTC+7) apa pun zona mesinnya", () => {
    expect(formatTime("2026-09-24T03:59:00.000Z")).toBe("10:59 WIB");
  });

  it("menggeser tanggal dengan benar untuk waktu dini hari UTC", () => {
    expect(formatTime("2026-09-23T20:00:00.000Z")).toBe("03:00 WIB");
  });

  it("mengembalikan string asli untuk input tidak valid", () => {
    expect(formatTime("n/a")).toBe("n/a");
  });
});

describe("formatDateTime", () => {
  it("menggabungkan tanggal dan waktu WIB", () => {
    expect(formatDateTime("2026-09-24T03:59:00.000Z")).toBe("24 Sep 2026 10:59 WIB");
  });
});

describe("formatDurationMs", () => {
  it("memakai milidetik di bawah satu detik", () => {
    expect(formatDurationMs(820)).toBe("820 ms");
  });

  it("memakai detik di atas satu detik dengan koma desimal", () => {
    expect(formatDurationMs(1200)).toBe("1,2 s");
    expect(formatDurationMs(2000)).toBe("2 s");
  });

  it("mengembalikan '-' kalau durasi tidak masuk akal (belum dilaporkan)", () => {
    expect(formatDurationMs(Number.NaN)).toBe("-");
    expect(formatDurationMs(-1)).toBe("-");
  });
});
