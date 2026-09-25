import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Konfigurasi test (mis. `npm run test`).
 *
 * - Alias `@/...` disamakan dengan tsconfig paths supaya test mengimpor modul
 *   yang sama seperti aplikasi.
 * - Vitest 4 memakai oxc untuk transform; JSX diaktifkan lewat opsi `oxc`
 *   (opsi `esbuild.jsx` diabaikan sejak oxc aktif, dan tsconfig memakai
 *   `jsx: "preserve"` untuk kebutuhan Next.js sehingga tidak bisa diandalkan).
 */
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", ".next-build/**"],
  },
});
