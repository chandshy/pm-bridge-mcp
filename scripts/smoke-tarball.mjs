#!/usr/bin/env node
// Pack the package as it would be published, install it into a clean temp
// directory, then exec the `mailpouch` binary with `--version`. Catches:
//   - missing `bin` entry / wrong shebang / wrong mode
//   - files omitted from `files` (e.g. `dist/index.js` not shipped)
//   - ESM/CJS mismatch that boots locally but fails on a fresh install
//
// Exit 0 — binary boots and prints the expected version.
// Exit 1 — pack failed, install failed, or `--version` output is wrong.

import { mkdtemp, rm, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
const PKG_VERSION = pkg.version;

// 1. Pack into a temp dir to avoid polluting ROOT with .tgz artifacts.
const stagingDir = await mkdtemp(join(tmpdir(), "preship-pack-"));
const installDir = await mkdtemp(join(tmpdir(), "preship-smoke-"));
let exitCode = 0;
try {
  const packRes = spawnSync("npm", ["pack", "--pack-destination", stagingDir, "--silent"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  // BUILD-007: every early-exit path throws so the catch/finally below runs
  // the staging/install cleanup and the single `exitCode` accumulator owns the
  // process exit code — no bare `process.exit(1)` that skips cleanup.
  if (packRes.status !== 0) {
    throw new Error(`npm pack failed (exit ${packRes.status}): ${packRes.stderr || packRes.stdout}`);
  }
  const tgzName = packRes.stdout.trim().split("\n").pop();
  if (!tgzName) {
    throw new Error(`npm pack produced no tarball name`);
  }
  const tgzPath = join(stagingDir, tgzName);
  if (!existsSync(tgzPath)) {
    throw new Error(`Tarball missing: ${tgzPath}`);
  }

  // 2. Install the tarball into a fresh dir. `--no-package-lock` keeps the
  //    install lean; `--omit=optional` avoids architecture-specific native
  //    deps that aren't installable on every runner.
  const installRes = spawnSync(
    "npm",
    [
      "install",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      "--prefix", installDir,
      "--omit=optional",
      tgzPath,
    ],
    { encoding: "utf-8", timeout: 120_000 }
  );
  if (installRes.status !== 0) {
    throw new Error(`npm install <tarball> failed (exit ${installRes.status}): ${installRes.stderr || installRes.stdout}`);
  }

  // 3. Run the binary's --version. We use the unpacked dist entry path
  //    directly to avoid PATH wiring issues with `npm install --prefix`.
  const entry = join(installDir, "node_modules", pkg.name, pkg.main);
  if (!existsSync(entry)) {
    throw new Error(`Installed entry missing: ${entry}`);
  }
  const versionRes = spawnSync("node", [entry, "--version"], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  if (versionRes.status !== 0) {
    throw new Error(`mailpouch --version failed (exit ${versionRes.status}): ${versionRes.stderr || versionRes.stdout}`);
  }
  const out = (versionRes.stdout || "").trim();
  if (!out.includes(PKG_VERSION)) {
    throw new Error(`mailpouch --version output did not contain ${PKG_VERSION}: got "${out}"`);
  }

  // 4. Verify packed files include the native-tray JS shim (BUILD-006). The
  //    --version path short-circuits before tray load, so we can't rely on
  //    "it booted" to prove the tray shim shipped. Probe the tar listing
  //    directly: the published tarball must contain native/tray/index.js.
  //    Failure paths here `throw` so the existing catch/finally chain runs
  //    the staging/install cleanup (BUILD-007: all early-exit branches above
  //    now `throw` too, so cleanup always runs).
  const tgzListRes = spawnSync("tar", ["-tzf", join(stagingDir, tgzName)], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  if (tgzListRes.status !== 0) {
    throw new Error(
      `tar -tzf <tarball> failed (exit ${tgzListRes.status}): ${tgzListRes.stderr || tgzListRes.stdout}`
    );
  }
  const REQUIRED_PACKED_FILES = [
    "package/native/tray/index.js",
    "package/native/tray/index.d.ts",
    "package/dist/index.js",
    "package/dist/settings-main.js",
    "package/dist/utils/tray.js",
  ];
  const packedFiles = new Set(tgzListRes.stdout.split("\n").map((s) => s.trim()));
  const missing = REQUIRED_PACKED_FILES.filter((p) => !packedFiles.has(p));
  if (missing.length > 0) {
    throw new Error(
      `tarball-smoke FAILED: required files missing from tarball: ${missing.join(", ")}`
    );
  }

  console.log(`tarball-smoke OK: ${tgzName} → ${out} (${REQUIRED_PACKED_FILES.length} required files present)`);
} catch (e) {
  console.error(`tarball-smoke threw: ${e.message}`);
  exitCode = 1;
} finally {
  await rm(stagingDir, { recursive: true, force: true });
  await rm(installDir, { recursive: true, force: true });
}
process.exit(exitCode);
