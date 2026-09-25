import { describe, it, expect, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { DataSourceBadge } from "./data-source-badge";

/**
 * Rules.md §1.4: badge "Data Simulasi" tidak boleh hilang saat mode mock aktif —
 * dan tidak boleh muncul saat data sudah live (kalau selalu muncul, badge jadi
 * tidak berarti apa-apa).
 */
const KEY = "NEXT_PUBLIC_USE_MOCK";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("DataSourceBadge", () => {
  it("tampil saat NEXT_PUBLIC_USE_MOCK=true", () => {
    process.env[KEY] = "true";
    const html = renderToString(<DataSourceBadge />);
    expect(html).toContain("Data Simulasi");
  });

  it("tidak tampil saat data live", () => {
    process.env[KEY] = "false";
    const html = renderToString(<DataSourceBadge />);
    expect(html).toBe("");
  });
});
