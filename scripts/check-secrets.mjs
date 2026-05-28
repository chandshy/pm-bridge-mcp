#!/usr/bin/env node
// Detect committed credentials/tokens.
//
// Strategy:
//   1. If `gitleaks` is on PATH, run it — it ships ~50 detectors and accepts
//      a config for tuning.
//   2. Otherwise fall back to `git grep` for a set of high-confidence patterns
//      (AWS access keys, OpenAI keys, Slack bot tokens, PEM private keys).
//      Narrower coverage but no install required.
//
// Exit 0 — no findings.
// Exit 1 — findings printed (redacted where the detector supports it).

import { spawnSync } from "node:child_process";

const HIGH_CONFIDENCE_PATTERNS = [
  // AWS access keys (AKIA + 16 chars)
  "AKIA[0-9A-Z]{16}",
  // OpenAI API keys (sk-… ≥ 32 chars)
  "sk-[A-Za-z0-9]{32,}",
  // Slack bot tokens
  "xox[baprs]-[A-Za-z0-9-]{10,}",
  // GitHub PATs (ghp_ / ghu_ / gho_ etc., legacy + fine-grained)
  "gh[pousr]_[A-Za-z0-9]{36,}",
  // SimpleLogin API keys (32-char hex) — embedded in mailpouch settings tooling
  "sl_[A-Fa-f0-9]{32}",
  // PEM private key headers
  "-----BEGIN [A-Z ]+ PRIVATE KEY-----",
];

const EXCLUDE_PATHSPECS = [
  ":!**/dist/**",
  ":!**/node_modules/**",
  ":!package-lock.json",
  ":!LICENSES.json",
  ":!CHANGELOG.md",
  ":!scripts/check-secrets.mjs",   // the patterns themselves shouldn't trigger
  ":!docs/preship.md",              // docs reference the patterns by name
];

function hasGitleaks() {
  const res = spawnSync("gitleaks", ["version"], { stdio: ["ignore", "pipe", "pipe"] });
  return res.status === 0;
}

function runGitleaks() {
  const res = spawnSync(
    "gitleaks",
    [
      "detect",
      "--no-banner",
      "--redact",
      "--source", ".",
      "--report-format", "json",
      "--report-path", "/dev/stdout",
      // We scan working tree, not history, so commits don't have to be amended.
      "--no-git",
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }
  );
  if (res.status === 0) {
    console.log("Secrets scan OK (gitleaks): 0 findings");
    return 0;
  }
  let findings = [];
  try {
    findings = JSON.parse(res.stdout);
  } catch {
    // gitleaks may print non-JSON on error
  }
  console.error(`Secrets scan FAILED (gitleaks): ${findings.length || "unknown"} findings`);
  if (Array.isArray(findings)) {
    for (const f of findings.slice(0, 20)) {
      console.error(`  - ${f.File}:${f.StartLine}  ${f.RuleID}  match: ${f.Secret ?? "(redacted)"}`);
    }
    if (findings.length > 20) console.error(`  … (${findings.length - 20} more)`);
  } else {
    console.error(res.stdout || res.stderr);
  }
  return 1;
}

function runGrepFallback() {
  const pattern = `(${HIGH_CONFIDENCE_PATTERNS.join("|")})`;
  const args = ["grep", "-nE", pattern, "--", ".", ...EXCLUDE_PATHSPECS];
  const res = spawnSync("git", args, { encoding: "utf-8" });
  // git grep: exit 0 with matches, 1 with none, 2+ on error.
  if (res.status === 1) {
    console.log("Secrets scan OK (grep fallback): 0 findings");
    console.log("  (consider installing gitleaks for broader coverage)");
    return 0;
  }
  if (res.status === 0) {
    const lines = res.stdout.split("\n").filter(Boolean);
    console.error(`Secrets scan FAILED (grep fallback): ${lines.length} findings`);
    for (const line of lines.slice(0, 20)) console.error(`  - ${line}`);
    if (lines.length > 20) console.error(`  … (${lines.length - 20} more)`);
    return 1;
  }
  console.error(`Secrets scan ERROR (git grep exit ${res.status}): ${res.stderr}`);
  return 1;
}

process.exit(hasGitleaks() ? runGitleaks() : runGrepFallback());
