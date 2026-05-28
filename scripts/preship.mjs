#!/usr/bin/env node
// Ship-readiness gate orchestrator.
//
// Usage:
//   node scripts/preship.mjs           # full preship (preship:fast + heavy)
//   node scripts/preship.mjs fast      # fast subset for pre-push hook
//   node scripts/preship.mjs release   # preship + tag-release checks
//
// Env knobs:
//   PRESHIP_NO_BRIDGE=1   — skip the e2e:bridge step (CI sets this; locally do
//                           NOT set it — Bridge tests are required for ship).
//   PRESHIP_VERBOSE=1     — print step output even on success.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runSteps, spawnNpmRun, spawnStep } from "./lib/preship-runner.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));

const level = process.argv[2] ?? "full";
if (!["fast", "full", "release"].includes(level)) {
  console.error(`Unknown preship level: ${level}. Use fast|full|release.`);
  process.exit(2);
}

// Emergency escape hatch — documented in docs/preship.md and referenced by
// the merge-pr skill. Loud to stderr so the bypass leaves an audit trail.
if (process.env.PRESHIP_SKIP === "1") {
  console.error(`BYPASS: PRESHIP_SKIP=1 — preship gate skipped for ${pkg.name} ${pkg.version} (${level}).`);
  console.error(`This is an emergency-only escape. Call it out in the PR description.`);
  process.exit(0);
}

// ─── Step definitions ────────────────────────────────────────────────────────

const STEP_NODE = (name, script, opts = {}) => ({
  name,
  mode: "hard",
  run: () => spawnStep("node", [join("scripts", script)], opts),
  ...opts,
});

const STEP_NPM = (name, scriptName, opts = {}) => ({
  name,
  mode: "hard",
  run: () => spawnNpmRun(scriptName, opts),
  ...opts,
});

const fastSteps = [
  STEP_NPM("typecheck", "typecheck"),
  // lint is currently identical to typecheck; keep as a no-op slot until a real
  // linter is wired so the table stays stable across the configurations.
  {
    name: "lint",
    mode: "hard",
    run: async () => ({ ok: true, summary: "alias of typecheck" }),
  },
  STEP_NODE("version-sync", "check-version-sync.mjs"),
  STEP_NODE("secrets", "check-secrets.mjs"),
  // npm-audit: HIGH/CRITICAL is a hard fail (the check script returns exit 1
  // on those; exit 2 on MODERATE/LOW; 0 on clean). We can't just lift exit-2
  // through `successWhen` — the runner suppresses output on ok=true, which
  // would hide the advisory findings the script writes to stderr. Instead we
  // forward the advisory text ourselves before returning ok=true.
  {
    name: "npm-audit",
    mode: "hard",
    run: async () => {
      const res = await spawnStep("node", [join("scripts", "check-npm-audit.mjs")]);
      if (res.exitCode === 0) {
        return { ok: true, summary: "no prod-dep findings" };
      }
      if (res.exitCode === 2) {
        if (res.output) process.stderr.write(res.output);
        return { ok: true, summary: "advisories printed above (non-blocking)" };
      }
      return {
        ok: false,
        summary: `HIGH/CRITICAL or unexpected exit ${res.exitCode}`,
        output: res.output,
      };
    },
  },
  STEP_NODE("license-inv", "check-licenses.mjs"),
  STEP_NPM("build", "build"),
  STEP_NPM("unit", "test"),
];

const heavySteps = [
  STEP_NODE("tarball-smoke", "smoke-tarball.mjs"),
  STEP_NPM("e2e:greenmail", "test:e2e:local"),
  {
    name: "e2e:bridge",
    mode: "hard",
    run: async () => {
      if (process.env.PRESHIP_NO_BRIDGE === "1") {
        return { ok: true, summary: "SKIPPED — PRESHIP_NO_BRIDGE=1" };
      }
      if (!process.env.MAILPOUCH_E2E_BRIDGE_CONFIG) {
        return {
          ok: false,
          summary: "MAILPOUCH_E2E_BRIDGE_CONFIG not set",
          output:
            "The Bridge E2E suite is required for ship. Set MAILPOUCH_E2E_BRIDGE_CONFIG=<path-to-bridge-config.json> and re-run preship, or set PRESHIP_NO_BRIDGE=1 to opt out (CI does this; locally you should not).",
        };
      }
      return spawnNpmRun("test:e2e:bridge");
    },
  },
];

const releaseSteps = [
  STEP_NPM("build:clean", "build:clean"),
  STEP_NODE("changelog-has-entry", "check-version-sync.mjs", { env: { CHECK_CHANGELOG_BODY: "1" } }),
  {
    name: "git-tag-free",
    mode: "hard",
    run: () =>
      spawnStep("git", ["rev-parse", "--verify", `v${pkg.version}`], {
        successWhen: ({ code }) => code !== 0,
        summary: `v${pkg.version}`,
      }),
  },
  {
    name: "npm-version-free",
    mode: "advisory",
    // Pass when npm explicitly says E404 ("version not published"); fail when
    // npm returns the version string ("already published"). Generic non-zero
    // (network down, registry unreachable) is reported as "could not verify"
    // — we don't want to give a false-green on an unreachable registry.
    run: async () => {
      const res = await spawnStep("npm", ["view", `${pkg.name}@${pkg.version}`, "version"]);
      const out = (res.output ?? "").trim();
      if (res.exitCode === 0 && out) {
        return { ok: false, summary: `${pkg.name}@${pkg.version} ALREADY PUBLISHED (${out})`, output: out };
      }
      if (res.exitCode !== 0 && /E404|not found|no such package/i.test(res.output ?? "")) {
        return { ok: true, summary: `${pkg.name}@${pkg.version} not yet published` };
      }
      // Unknown — registry unreachable or unexpected output. Return ok:false
      // so the advisory mode surfaces it as a warning instead of silently
      // marking the version "free". Operator should re-run when the registry
      // is reachable.
      return {
        ok: false,
        summary: `${pkg.name}@${pkg.version} — could not verify (registry unreachable?)`,
        output: res.output ?? "",
      };
    },
  },
];

const stepsByLevel = {
  fast: fastSteps,
  full: [...fastSteps, ...heavySteps],
  release: [...fastSteps, ...heavySteps, ...releaseSteps],
};

const header = `PRESHIP — ${pkg.name} ${pkg.version} (${level})`;
const { ok } = await runSteps(stepsByLevel[level], {
  header,
  verbose: process.env.PRESHIP_VERBOSE === "1",
});
process.exit(ok ? 0 : 1);
