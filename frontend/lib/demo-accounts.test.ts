import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "./demo-accounts";
import { MOCK_DECISIONS, MOCK_LOCATIONS, MOCK_USERS } from "./mock-data";
import { scopeForRole } from "./role";
import { decisionTouchesScope } from "./scope";

/**
 * Email akun demo yang TERTULIS di docs/design.md §1.5 dan di-seed backend
 * (`backend/app/db_seed.py` → `UI_DEMO_EMAILS`). Nilainya sengaja diulang di sini: test ini
 * yang menahan ketiga tempat (UI, mock, seed) agar tidak menyimpang diam-diam.
 */
const DOCUMENTED_EMAILS = [
  "sppg.head@demo.local",
  "sppg.nutritionist@demo.local",
  "bgn.monitor@demo.local",
];

describe("akun demo halaman login", () => {
  it("memakai email yang terdokumentasi, berurutan", () => {
    expect(DEMO_ACCOUNTS.map((account) => account.username)).toEqual(DOCUMENTED_EMAILS);
  });

  it("dikenali mode mock dengan password & peran yang sama", () => {
    for (const account of DEMO_ACCOUNTS) {
      const mock = MOCK_USERS[account.username];
      expect(mock, `${account.username} tidak ada di MOCK_USERS`).toBeDefined();
      expect(mock.password, `password ${account.username} berbeda dengan mock`).toBe(
        account.password,
      );
      expect(mock.user.role, `peran ${account.username} berbeda dengan mock`).toBe(account.role);
    }
  });

  it("tidak ada email duplikat", () => {
    const emails = DEMO_ACCOUNTS.map((account) => account.username);
    expect(new Set(emails).size).toBe(emails.length);
  });
});

describe("cakupan akun demo (revisi 10 Okt 2026: satu orang = satu SPPG)", () => {
  it("akun peran SPPG membawa locationId yang benar-benar ada", () => {
    for (const account of DEMO_ACCOUNTS) {
      const user = MOCK_USERS[account.username].user;
      if (account.role === "bgn_monitor") {
        // Monitor BGN memang lintas lokasi — bukan kelalaian.
        expect(user.locationId).toBeUndefined();
        continue;
      }
      expect(user.locationId, `${account.username} tanpa locationId`).toBeTruthy();
      const ada = MOCK_LOCATIONS.some((location) => location.id === user.locationId);
      expect(ada, `${account.username}: ${user.locationId} tidak ada di MOCK_LOCATIONS`).toBe(
        true,
      );
    }
  });

  it("kepala & ahli gizi demo dari SPPG yang SAMA (syarat 2 approval verifier_flagged)", () => {
    const kepala = MOCK_USERS["sppg.head@demo.local"].user;
    const gizi = MOCK_USERS["sppg.nutritionist@demo.local"].user;
    expect(gizi.locationId).toBe(kepala.locationId);
  });

  it("label akun SPPG menyebut SPPG-nya, bukan wilayah", () => {
    for (const account of DEMO_ACCOUNTS) {
      if (account.role === "bgn_monitor") continue;
      expect(account.detail).toMatch(/^SPPG /);
    }
  });

  it("akun kepala SPPG punya pekerjaan yang bisa didemokan di SPPG-nya", () => {
    const kepala = MOCK_USERS["sppg.head@demo.local"].user;
    // `User` memakai field opsional; `scopeForRole` menuntut null eksplisit (gagal-tertutup).
    const scope = scopeForRole(kepala.role, {
      region: kepala.region ?? null,
      locationId: kepala.locationId ?? null,
    });
    const dalamCakupan = MOCK_DECISIONS.filter((decision) =>
      decisionTouchesScope(decision, scope, MOCK_LOCATIONS),
    );

    // Momen "Approve" di demo tidak boleh hilang ...
    expect(dalamCakupan.some((d) => d.status === "pending_approval")).toBe(true);
    // ... dan alur 2 approval (verifier_flagged) harus bisa diselesaikan akun yang ada.
    expect(dalamCakupan.some((d) => d.status === "verifier_flagged")).toBe(true);
  });
});
