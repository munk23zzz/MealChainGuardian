import fs from "node:fs";

// --- exFAT workaround -----------------------------------------------------
// E: drive is exFAT. On exFAT, fs.readlink/readlinkSync on a *regular file*
// throws EISDIR, whereas NTFS correctly returns EINVAL ("not a symlink").
// webpack's file tracing calls readlink on every file during `next build`,
// so the build crashes on exFAT. Map EISDIR -> EINVAL so callers treat a
// regular file as "not a symlink" (the correct semantics).
function readlinkError(path, code, errno) {
  const err = new Error(`${code}: invalid argument, readlink '${path}'`);
  err.code = code;
  err.errno = errno;
  err.syscall = "readlink";
  err.path = path;
  return err;
}

const origReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function (path, ...rest) {
  try {
    return origReadlinkSync.call(fs, path, ...rest);
  } catch (err) {
    if (err && err.code === "EISDIR") {
      throw readlinkError(path, "EINVAL", -22);
    }
    throw err;
  }
};

const origReadlink = fs.readlink;
fs.readlink = function (path, ...rest) {
  const cb = rest[rest.length - 1];
  if (typeof cb === "function") {
    const args = rest.slice(0, -1);
    return origReadlink.call(fs, path, ...args, (err, ...res) => {
      if (err && err.code === "EISDIR") {
        err = readlinkError(path, "EINVAL", -22);
      }
      cb(err, ...res);
    });
  }
  return origReadlink.call(fs, path, ...rest);
};
// ---------------------------------------------------------------------------

/** @type {import('next').NextConfig} */
// Ekspor statis untuk GitHub Pages (lihat .github/workflows/deploy-pages.yml).
// Di lokal STATIC_EXPORT tidak diset, jadi aplikasi tetap Next biasa (dev server + SSR).
const STATIC_EXPORT = process.env.STATIC_EXPORT === "true";
// GitHub Pages menyajikan repo di sub-path (mis. /MealChainGuardian), bukan di akar domain.
// Kosong = akar domain (dipakai lokal: http://localhost:3000).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  // `next dev` mengunci .next/ (mis. .next/trace) sehingga `npm run build` di
  // workspace yang sama bisa gagal EPERM. Set NEXT_DIST_DIR untuk build ke folder
  // lain (mis. NEXT_DIST_DIR=.next-build npm run build) tanpa mengganggu dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: STATIC_EXPORT ? "export" : undefined,
  basePath: BASE_PATH,
  assetPrefix: BASE_PATH || undefined,
  // Wajib untuk ekspor statis: tiap rute ditulis sebagai <rute>/index.html sehingga
  // Pages menyajikannya langsung, dan tautan dalam tidak perlu penulisan ulang server.
  trailingSlash: true,
  // Ekspor statis tidak punya optimizer gambar.
  images: { unoptimized: true },
  webpack: (config) => {
    // Disable webpack's filesystem cache: its realpath snapshot also trips
    // over the exFAT readlink behavior described above.
    config.cache = false;
    return config;
  },
};

export default nextConfig;
