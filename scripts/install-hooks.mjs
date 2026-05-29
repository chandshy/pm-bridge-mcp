#!/usr/bin/env node
// Conditional git-hook installer.
//
// Runs from `postinstall`. We only want to install `simple-git-hooks` in two
// situations:
//
//   1. A contributor cloned this repo and ran `npm install` at its root.
//   2. CI ran `npm ci` inside a checkout of this repo.
//
// We do NOT want hooks to install when somebody downstream pulls mailpouch in
// as a dependency (e.g. `npm install mailpouch`, `npm i github:chandshy/mailpouch`,
// or `pnpm add mailpouch` in their own project). That class of install is what
// BUILD-001 in docs/audit-2026-05-28.md describes — `simple-git-hooks` writing
// `.git/hooks/pre-push` into the consumer's repo, which is a silent surprise.
//
// Root detection: npm sets `INIT_CWD` to the directory `npm install` was invoked
// from. For a top-level install of mailpouch by a contributor it equals the
// repo root (= this script's `process.cwd()` at postinstall time). For a
// downstream install it equals the consumer's project directory, which is NOT
// the same as the package directory mailpouch was extracted into.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const initCwd = process.env.INIT_CWD ? resolve(process.env.INIT_CWD) : null;
const here = resolve(process.cwd());

// Heuristics, all of which must hold:
//   - INIT_CWD is set (no INIT_CWD → installed by something other than npm —
//     skip rather than guess).
//   - INIT_CWD equals the package directory (= we're at the root of OUR repo,
//     not nested under someone else's node_modules).
//   - A `.git` directory exists at the root (this is a checkout, not a packed
//     tarball install).
//   - The simple-git-hooks config exists (defense in depth; should always be
//     true for our package.json but if someone strips it we don't want a
//     spurious CLI invocation).
const isRootInstall = initCwd !== null && initCwd === here;
const hasGitDir = existsSync(join(here, '.git'));

if (!isRootInstall || !hasGitDir) {
  // Silent no-op in the consumer-install path — postinstall is allowed to be
  // chatty in dev but should be invisible when running on a downstream user's
  // machine.
  process.exit(0);
}

// Local dev path: run the simple-git-hooks CLI. Use spawnSync so that any
// non-zero exit propagates to npm, and so we surface the CLI's output
// verbatim (it's already concise).
const result = spawnSync(process.execPath, [
  join(here, 'node_modules', 'simple-git-hooks', 'cli.js'),
], {
  stdio: 'inherit',
  cwd: here,
});

if (result.status !== 0) {
  // Don't fail the whole install over hook-setup hiccups — a contributor can
  // re-run `npx simple-git-hooks` by hand. Warn loudly so they notice.
  console.warn('[install-hooks] simple-git-hooks exited non-zero; hooks may not be installed.');
}

process.exit(0);
