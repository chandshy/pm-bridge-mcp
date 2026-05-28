#!/usr/bin/env node
// Enforce that package.json version, README badge, and the latest CHANGELOG
// entry all agree. Single source of truth is package.json.
//
// Exit 0 — all three match.
// Exit 1 — drift detected; the mismatch is printed.
//
// Env knobs:
//   CHECK_CHANGELOG_BODY=1 — also require the latest CHANGELOG entry to have
//                            non-empty body text. Used by preship:release.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8"));
const PKG_VERSION = pkg.version;

const readme = await readFile(join(ROOT, "README.md"), "utf-8");
const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf-8");

const problems = [];

// README badge — look for `npm-vX.Y.Z` in a shields.io URL.
const badgeMatch = readme.match(/img\.shields\.io\/badge\/npm-v([\d.]+)-/);
if (!badgeMatch) {
  problems.push("README.md: could not locate an `npm-vX.Y.Z` shields.io badge.");
} else if (badgeMatch[1] !== PKG_VERSION) {
  problems.push(
    `README.md badge is v${badgeMatch[1]} but package.json is ${PKG_VERSION}. ` +
      `Update README.md.`
  );
}

// CHANGELOG — first heading must be `## [X.Y.Z] — DATE` and equal PKG_VERSION.
const headingRe = /^## \[([\d.]+)\]/m;
const headingMatch = changelog.match(headingRe);
if (!headingMatch) {
  problems.push("CHANGELOG.md: no `## [X.Y.Z]` heading found.");
} else if (headingMatch[1] !== PKG_VERSION) {
  problems.push(
    `CHANGELOG.md latest entry is [${headingMatch[1]}] but package.json is ${PKG_VERSION}. ` +
      `Add a new CHANGELOG entry.`
  );
}

// Optional body check for release-grade enforcement.
if (process.env.CHECK_CHANGELOG_BODY === "1" && headingMatch) {
  const startIdx = headingMatch.index;
  // Body is everything until the next `## [` heading (or end of file).
  const rest = changelog.slice(startIdx + headingMatch[0].length);
  const nextIdx = rest.search(/^## \[/m);
  const body = (nextIdx === -1 ? rest : rest.slice(0, nextIdx)).trim();
  if (!body) {
    problems.push(
      `CHANGELOG.md entry [${PKG_VERSION}] has an empty body. ` +
        `Document what shipped.`
    );
  }
}

if (problems.length > 0) {
  console.error(`Version sync FAILED (package.json ${PKG_VERSION}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`Version sync OK: package.json/README/CHANGELOG all → ${PKG_VERSION}`);
