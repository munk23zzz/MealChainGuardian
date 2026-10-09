import { describe, expect, it } from "vitest";
import {
  ACCEPTED_TYPES,
  MAX_UPLOAD_BYTES,
  downscale,
  estimateDataUrlBytes,
  formatFileSize,
  isAcceptableImage,
} from "@/lib/image";

describe("downscale", () => {
  it("tidak memperbesar gambar yang sudah kecil", () => {
    expect(downscale({ width: 640, height: 480 }, 1280)).toEqual({
      width: 640,
      height: 480,
      scale: 1,
    });
  });

  it("memperkecil dengan menjaga rasio", () => {
    const result = downscale({ width: 4000, height: 3000 }, 1280);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(960);
    expect(result.scale).toBeCloseTo(0.32);
  });

  it("memakai sisi terpanjang (potret maupun lanskap)", () => {
    expect(downscale({ width: 3000, height: 4000 }, 1000).height).toBe(1000);
    expect(downscale({ width: 3000, height: 4000 }, 1000).width).toBe(750);
  });

  it("tidak pernah menghasilkan 0 piksel", () => {
    const result = downscale({ width: 10000, height: 10 }, 100);
    expect(result.width).toBe(100);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("masukan tidak sah dikembalikan sebagai 1×1", () => {
    expect(downscale({ width: 0, height: 0 })).toEqual({ width: 1, height: 1, scale: 1 });
    expect(downscale({ width: Number.NaN, height: 10 })).toEqual({
      width: 1,
      height: 1,
      scale: 1,
    });
  });
});

describe("formatFileSize", () => {
  it("memilih satuan yang masuk akal", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatFileSize(-1)).toBe("0 KB");
  });
});

describe("isAcceptableImage", () => {
  it("menerima format yang didukung", () => {
    for (const type of ACCEPTED_TYPES) {
      expect(isAcceptableImage({ type, size: 1024 }).ok).toBe(true);
    }
  });

  it("menolak format lain dengan alasan yang jelas", () => {
    const result = isAcceptableImage({ type: "application/pdf", size: 1024 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("JPG");
  });

  it("menolak berkas terlalu besar atau kosong", () => {
    expect(isAcceptableImage({ type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 }).reason).toContain(
      "maksimal",
    );
    expect(isAcceptableImage({ type: "image/jpeg", size: 0 }).reason).toBe("Berkas kosong");
  });
});

describe("estimateDataUrlBytes", () => {
  it("mengubah panjang base64 kembali ke ukuran byte", () => {
    const tiny = "data:image/jpeg;base64,AAAA"; // 4 karakter → 3 byte
    expect(estimateDataUrlBytes(tiny)).toBe(3);
  });

  it("aman untuk data URL tanpa koma", () => {
    expect(estimateDataUrlBytes("bukan-data-url")).toBe(0);
  });
});
