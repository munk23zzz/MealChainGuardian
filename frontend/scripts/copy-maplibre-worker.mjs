/**
 * Salin worker MapLibre (+ modul yang diimpornya) ke `public/` supaya bisa dimuat
 * sebagai file statis.
 *
 * Kenapa: saat di-bundle webpack, MapLibre tidak menemukan URL worker-nya
 * ("Worker failed to load") sehingga peta tidak memuat tile. Menyajikan worker
 * apa adanya dari /public + `setWorkerUrl(...)` adalah cara paling sederhana dan
 * tahan-update (tidak bergantung cara Next menangani `?worker` import).
 *
 * PENTING: `maplibre-gl-worker.mjs` mengimpor `./maplibre-gl-shared.mjs`
 * (module worker), jadi keduanya WAJIB disalin — kalau tidak, worker 404 dan
 * peta gagal memuat tile.
 *
 * Dijalankan otomatis lewat `predev` / `prebuild` di package.json.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(resolve("public"), { recursive: true });

for (const file of FILES) {
  const source = resolve("node_modules/maplibre-gl/dist", file);
  const target = resolve("public", file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`worker MapLibre disalin: ${file}`);
}
