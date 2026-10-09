import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS } from "./demo-accounts";
import { MOCK_USERS } from "./mock-data";

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
