// exFAT readlink workaround (preload via NODE_OPTIONS=--require).
// On exFAT, fs.readlink/readlinkSync on a REGULAR file throws EISDIR instead
// of EINVAL (NTFS returns EINVAL = "not a symlink"). webpack + graceful-fs
// call readlink on every file during `next build`, so the build crashes.
// This must run before graceful-fs/webpack load (hence a --require preload),
// and it also re-patches graceful-fs if it is already loaded.
"use strict";

const fs = require("fs");

function makeReadlinkError(path, code, errno) {
  const err = new Error(`${code}: invalid argument, readlink '${path}'`);
  err.code = code;
  err.errno = errno;
  err.syscall = "readlink";
  err.path = path;
  return err;
}

function wrap(fn, path, code, errno) {
  try {
    return fn();
  } catch (err) {
    if (err && err.code === "EISDIR") {
      throw makeReadlinkError(path, code, errno);
    }
    throw err;
  }
}

function patch(target) {
  if (!target || target.__exfatPatched) return;
  target.__exfatPatched = true;

  const origSync = target.readlinkSync;
  target.readlinkSync = function (path, ...rest) {
    return wrap(() => origSync.call(target, path, ...rest), path, "EINVAL", -22);
  };

  const orig = target.readlink;
  target.readlink = function (path, ...rest) {
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") {
      const args = rest.slice(0, -1);
      return orig.call(target, path, ...args, (err, ...res) => {
        if (err && err.code === "EISDIR") {
          err = makeReadlinkError(path, "EINVAL", -22);
        }
        cb(err, ...res);
      });
    }
    return orig.call(target, path, ...rest);
  };
}

// Patch plain fs first.
patch(fs);

// Patch the promises API too — @vercel/nft uses fs.promises.readlink during
// output file tracing.
if (fs.promises && !fs.promises.__exfatPatched) {
  fs.promises.__exfatPatched = true;
  const origPromiseSync = fs.promises.readlink;
  fs.promises.readlink = async function (path, ...rest) {
    try {
      return await origPromiseSync.call(fs.promises, path, ...rest);
    } catch (err) {
      if (err && err.code === "EISDIR") {
        throw makeReadlinkError(path, "EINVAL", -22);
      }
      throw err;
    }
  };
}

// graceful-fs clones fs at load time; patch it too if present.
try {
  patch(require("graceful-fs"));
} catch {
  // graceful-fs not installed or not yet resolvable — plain fs patch suffices.
}
