import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { StatusBadge } from "./status-badge";

/**
 * design.md §1.2: status keamanan tidak boleh ambigu — PASS/FAIL/
 * NEEDS_VERIFICATION harus punya label & warna yang konsisten di seluruh app.
 */
describe("StatusBadge", () => {
  it("menampilkan enum keamanan apa adanya, dengan warna token design.md", () => {
    const fail = renderToString(<StatusBadge kind="safety" value="FAIL" />);
    expect(fail).toContain("FAIL");
    expect(fail).toContain("text-status-danger");

    const pass = renderToString(<StatusBadge kind="safety" value="PASS" />);
    expect(pass).toContain("PASS");
    expect(pass).toContain("text-status-safe");

    const need = renderToString(
      <StatusBadge kind="safety" value="NEEDS_VERIFICATION" />,
    );
    expect(need).toContain("NEEDS_VERIFICATION");
    expect(need).toContain("bg-status-warning");
  });

  it("menerima status keputusan lama (pending_review) sebagai Menunggu approval", () => {
    const html = renderToString(<StatusBadge kind="decision" value="pending_review" />);
    expect(html).toContain("Menunggu approval");
  });

  it("status keputusan tak dikenal tidak diklaim lebih aman (jadi Diusulkan)", () => {
    const html = renderToString(<StatusBadge kind="decision" value="entah" />);
    expect(html).toContain("Diusulkan");
  });

  it("bukti yang belum diuji ditandai netral, bukan hijau", () => {
    const html = renderToString(<StatusBadge kind="evidence" value={null} />);
    expect(html).toContain("belum diuji");
    expect(html).not.toContain("text-status-safe");
  });

  it("status lokasi memakai label design.md §3.1", () => {
    expect(
      renderToString(<StatusBadge kind="location" value="warning" />),
    ).toContain("Tight");
  });
});
