# preship — the ship-readiness gate

Every ship runs through `npm run preship`. The gate exists because correctness checks that depend on a human remembering to run them eventually don't get run. preship makes the full set non-bypassable.

## TL;DR

```bash
# Before you ship: full gate (~5 minutes; requires Bridge running)
npm run preship

# Quick gate (< 30 s; runs on every `git push` via pre-push hook)
npm run preship:fast

# Release-grade gate (before `npm publish`)
npm run preship:release
```

`npm publish` is wired to refuse to run unless `preship:release` is green (`prepublishOnly`).

## What runs

### preship:fast — < 30 s

| Step | What it checks | Hard fail? |
|------|----------------|-----------|
| `typecheck` | `tsc --noEmit` | yes |
| `lint` | Currently aliases typecheck (placeholder until a real linter is wired) | yes |
| `version-sync` | `package.json` version matches the README badge and the latest `CHANGELOG.md` heading | yes |
| `secrets` | gitleaks (if installed) or grep heuristic for AWS keys / OpenAI keys / Slack tokens / GitHub PATs / PEM private keys | yes |
| `npm-audit` | `npm audit --omit=dev`; HIGH/CRITICAL block, MODERATE/LOW are advisory | yes on HIGH/CRITICAL |
| `license-inv` | Prod-dep license inventory at `LICENSES.json` is up to date | yes on drift |
| `build` | `tsc` produces a working `dist/` | yes |
| `unit` | `vitest run` (excludes `test/agent-harness.test.ts`) | yes |

### preship — adds, after preship:fast

| Step | What it checks | Hard fail? |
|------|----------------|-----------|
| `tarball-smoke` | `npm pack` → install in temp dir → `mailpouch --version` boots and prints the right version | yes |
| `e2e:greenmail` | Phase-1 E2E suite via Greenmail Docker container | yes |
| `e2e:bridge` | Phase-2 E2E suite via real Proton Bridge | yes (locally); CI sets `PRESHIP_NO_BRIDGE=1` to skip |

### preship:release — adds, after preship

| Step | What it checks | Hard fail? |
|------|----------------|-----------|
| `build:clean` | Full clean build (catches stale-dist regressions) | yes |
| `changelog-has-entry` | Latest `## [X.Y.Z]` CHANGELOG entry has non-empty body | yes |
| `git-tag-free` | No existing `vX.Y.Z` tag (sanity check before tagging) | yes |
| `npm-version-free` | `mailpouch@X.Y.Z` isn't already on npm. Reports "not yet published" only when the registry explicitly returns E404; on registry unreachable, reports "could not verify" without claiming the version is free | advisory |

## Running individual checks

Every check is also exposed as its own npm script — handy when debugging a single failure without re-running the whole gate.

```bash
npm run check:version-sync
npm run check:secrets
npm run check:npm-audit
npm run check:licenses
npm run check:tarball
```

Each exits 0 on pass, non-zero on failure, and prints actionable detail.

## When something fails

The gate prints which step failed and the captured stdout/stderr. Common ones:

### `version-sync` failed

```
Version sync FAILED (package.json 3.0.42):
  - README.md badge is v3.0.41 but package.json is 3.0.42. Update README.md.
```

Bump the README badge and the CHANGELOG to match. The single source of truth is `package.json`.

### `secrets` failed

If `gitleaks` flagged something, the path + line + rule is in the output. If you're using the grep fallback (no gitleaks installed), the literal match line is printed.

**Real secret**: rotate it, scrub history (`git filter-repo`), then re-stage without the secret. Don't just delete in a new commit.

**False positive in test fixtures**: move the example to a fixture file that matches the path-exclude list in `scripts/check-secrets.mjs:30` (currently excludes `dist/`, `node_modules/`, `package-lock.json`, `LICENSES.json`, `CHANGELOG.md`, `scripts/check-secrets.mjs` itself, `docs/preship.md`).

### `npm-audit` failed on HIGH/CRITICAL

```
npm-audit FAILED: 1 HIGH/CRITICAL finding(s):
  - [HIGH] some-dep  (advisory 1234)  Prototype pollution in some-dep
```

First try `npm audit fix`. If that doesn't resolve it (no patch available), and the advisory genuinely doesn't apply to mailpouch (e.g. server-side dep used only at build time), add it to `.preship-audit-allow.json`:

```json
{
  "allow": [
    { "id": 1234, "reason": "false positive — runtime path not reachable; see PR #999" }
  ]
}
```

### `license-inv` drift

```
license-inv DRIFT detected:
  + 2 added:
      some-new-dep@1.0.0  MIT
```

Expected after `npm install` adds a dep. Regenerate the baseline and commit:

```bash
PRESHIP_LICENSE_WRITE=1 node scripts/check-licenses.mjs
git add LICENSES.json
```

### `tarball-smoke` failed

Usually one of:
- `mailpouch --version` produced no output → `bin` mis-wired in `package.json`
- File missing → `files` in `package.json` doesn't include the path that `dist/index.js` imports
- `Permission denied` → shebang missing on `dist/index.js`

### `e2e:greenmail` / `e2e:bridge` failed

See [`test/e2e/README.md`](../test/e2e/README.md) for the harness layout, the
two-phase model, and Greenmail vs Bridge quirks.

## Bypassing the gate

Don't, in normal operation. For emergencies:

| Surface | Bypass |
|---------|--------|
| Pre-push hook | `git push --no-verify` |
| Ship skill (`/ship`) | `PRESHIP_SKIP=1 /ship` |
| Any `npm run preship*` invocation | `PRESHIP_SKIP=1 npm run preship` (short-circuits at the top of `scripts/preship.mjs` with a loud `BYPASS: PRESHIP_SKIP=1` line to stderr) |
| `npm publish` | Not bypassable. `prepublishOnly` runs preship:release; remove the script line only as part of an explicit rescue plan and revert immediately. |

Every bypass logs to stderr so a reader can see it happened (and `BYPASS:` lines are grep-able from CI logs).

## Installing gitleaks (recommended)

The grep fallback covers ~5 high-confidence credential patterns. gitleaks ships ~50 detectors plus history scanning.

```bash
# macOS
brew install gitleaks

# Linux (Go)
go install github.com/gitleaks/gitleaks/v8@latest

# Verify
gitleaks version
npm run check:secrets   # should now say "gitleaks: 0 findings"
```

## CI carve-out: Bridge is local-only

Proton Bridge is a desktop application and cannot run on GitHub-hosted runners. The CI workflow (`.github/workflows/preship.yml`) sets `PRESHIP_NO_BRIDGE=1`, which makes the `e2e:bridge` step print `SKIPPED — PRESHIP_NO_BRIDGE=1` and exit 0.

On a developer machine, Bridge is **hard-required** by `npm run preship`. Set `MAILPOUCH_E2E_BRIDGE_CONFIG=<path-to-bridge-config.json>` to enable Bridge tests; without it, the step fails with a clear message pointing here.

## Files involved

- `scripts/preship.mjs` — orchestrator
- `scripts/lib/preship-runner.mjs` — sequential runner + summary formatter
- `scripts/check-*.mjs` — five individual checks
- `scripts/smoke-tarball.mjs`
- `LICENSES.json` — committed license-inventory baseline (regenerated with `PRESHIP_LICENSE_WRITE=1`)
- `.preship-audit-allow.json` — committed acknowledgement list (starts empty)
- `.github/workflows/preship.yml` — CI gate
- `package.json` — `simple-git-hooks` block pins the pre-push hook to `preship:fast`
