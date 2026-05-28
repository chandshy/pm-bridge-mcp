#!/usr/bin/env node
// Generate or verify the prod-dep license inventory at `LICENSES.json`.
//
// First run on a project: writes LICENSES.json from `npm ls --json --omit=dev`
// (commit it). Subsequent runs: diff against the committed file — any drift
// (new dep, removed dep, license changed) → hard fail. Unknown / non-SPDX
// licenses are advisory.
//
// Manual update flow: re-run with PRESHIP_LICENSE_WRITE=1 to overwrite the
// baseline, then commit.
//
// Exit 0 — no drift.
// Exit 1 — drift OR write requested.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INVENTORY = join(ROOT, "LICENSES.json");

const res = spawnSync("npm", ["ls", "--all", "--json", "--omit=dev", "--long"], {
  encoding: "utf-8",
  cwd: ROOT,
  maxBuffer: 32 * 1024 * 1024,
});
if (res.status !== 0 && !res.stdout) {
  console.error(`npm ls failed (exit ${res.status}): ${res.stderr}`);
  process.exit(1);
}

const tree = JSON.parse(res.stdout);
const flat = [];

function visit(node, name) {
  if (!node || typeof node !== "object") return;
  if (name && name !== tree.name) {
    flat.push({
      name,
      version: node.version ?? "(unknown)",
      license: normalizeLicense(node.license),
    });
  }
  for (const [child, sub] of Object.entries(node.dependencies ?? {})) {
    visit(sub, child);
  }
}

function normalizeLicense(license) {
  if (!license) return "UNKNOWN";
  if (typeof license === "string") return license;
  if (Array.isArray(license)) return license.map((l) => l?.type ?? l).filter(Boolean).join(" OR ");
  if (typeof license === "object" && license.type) return license.type;
  return "UNKNOWN";
}

visit(tree, null);
// Dedupe by name+version (same package may appear multiple times in the tree).
const seen = new Map();
for (const dep of flat) {
  const key = `${dep.name}@${dep.version}`;
  if (!seen.has(key)) seen.set(key, dep);
}
const current = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));

const writeMode = process.env.PRESHIP_LICENSE_WRITE === "1";
if (writeMode || !existsSync(INVENTORY)) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    rootPackage: `${tree.name}@${tree.version}`,
    deps: current,
  };
  await writeFile(INVENTORY, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${INVENTORY} (${current.length} prod deps).`);
  // Wrote-and-exited counts as "drift" for safety on first run.
  process.exit(writeMode ? 0 : 1);
}

const baseline = JSON.parse(await readFile(INVENTORY, "utf-8"));
const baselineByKey = new Map((baseline.deps ?? []).map((d) => [`${d.name}@${d.version}`, d]));
const currentByKey = new Map(current.map((d) => [`${d.name}@${d.version}`, d]));

const added = [];
const removed = [];
const licenseChanged = [];
for (const [key, dep] of currentByKey.entries()) {
  if (!baselineByKey.has(key)) added.push(dep);
  else if (baselineByKey.get(key).license !== dep.license) {
    licenseChanged.push({ key, was: baselineByKey.get(key).license, now: dep.license });
  }
}
for (const [key, dep] of baselineByKey.entries()) {
  if (!currentByKey.has(key)) removed.push(dep);
}

const unknown = current.filter((d) => d.license === "UNKNOWN");

const drifted = added.length + removed.length + licenseChanged.length;
if (drifted > 0) {
  console.error(`license-inv DRIFT detected:`);
  if (added.length > 0) {
    console.error(`  + ${added.length} added:`);
    for (const d of added.slice(0, 10)) console.error(`      ${d.name}@${d.version}  ${d.license}`);
    if (added.length > 10) console.error(`      … (${added.length - 10} more)`);
  }
  if (removed.length > 0) {
    console.error(`  - ${removed.length} removed:`);
    for (const d of removed.slice(0, 10)) console.error(`      ${d.name}@${d.version}  ${d.license}`);
    if (removed.length > 10) console.error(`      … (${removed.length - 10} more)`);
  }
  if (licenseChanged.length > 0) {
    console.error(`  ~ ${licenseChanged.length} license changed:`);
    for (const c of licenseChanged.slice(0, 10)) {
      console.error(`      ${c.key}  ${c.was} → ${c.now}`);
    }
  }
  console.error(`To accept: PRESHIP_LICENSE_WRITE=1 node scripts/check-licenses.mjs && git add LICENSES.json`);
  process.exit(1);
}

if (unknown.length > 0) {
  console.error(`license-inv advisory: ${unknown.length} dep(s) with UNKNOWN license:`);
  for (const d of unknown.slice(0, 10)) console.error(`  - ${d.name}@${d.version}`);
}

console.log(`license-inv OK: ${current.length} prod deps, no drift.`);
