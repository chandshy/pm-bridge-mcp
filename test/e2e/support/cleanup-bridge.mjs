#!/usr/bin/env node
/**
 * Cleanup orphan E2E test folders/labels from Proton Bridge.
 *
 * Phase-2 scenarios create isolated mailboxes under the prefixes:
 *   Folders/E2E-<timestamp>-<random>
 *   Labels/E2E-<timestamp>-<random>
 *
 * Tests clean up after themselves on success, but a crashed run can leave
 * orphans. This script lists every Folders/E2E-* and Labels/E2E-* mailbox
 * and deletes them.
 *
 * Usage:
 *   MAILPOUCH_E2E_BRIDGE_CONFIG=~/.mailpouch.bridge-test.json \
 *     node test/e2e/support/cleanup-bridge.mjs
 *
 * Exits 0 on success (including when nothing needs cleaning). Exits 1 on
 * configuration / connection error.
 */

import { readFileSync, existsSync } from "fs";
import { ImapFlow } from "imapflow";

const configPath = process.env.MAILPOUCH_E2E_BRIDGE_CONFIG;
if (!configPath) {
  console.error("MAILPOUCH_E2E_BRIDGE_CONFIG is not set.");
  process.exit(1);
}
if (!existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, "utf-8"));
const conn = config.connection ?? {};
if (!conn.imapHost || !conn.username || !conn.password) {
  console.error("Config is missing connection.imapHost / username / password.");
  process.exit(1);
}

const client = new ImapFlow({
  host: conn.imapHost,
  port: conn.imapPort ?? 1143,
  secure: false,
  auth: { user: conn.username, pass: conn.password },
  logger: false,
  tls: { rejectUnauthorized: false },
});

const orphanRe = /^(Folders|Labels)\/E2E-/;

try {
  await client.connect();
  const list = await client.list();
  const orphans = list.filter((m) => orphanRe.test(m.path));
  if (orphans.length === 0) {
    console.log("nothing to clean");
    await client.logout();
    process.exit(0);
  }
  console.log(`Found ${orphans.length} orphan E2E mailboxes:`);
  for (const m of orphans) console.log(`  ${m.path}`);
  // Delete deepest first.
  orphans.sort((a, b) => b.path.length - a.path.length);
  for (const m of orphans) {
    try {
      await client.mailboxDelete(m.path);
      console.log(`  deleted ${m.path}`);
    } catch (e) {
      console.error(`  failed to delete ${m.path}: ${e.message}`);
    }
  }
  await client.logout();
  process.exit(0);
} catch (e) {
  console.error(`Bridge cleanup failed: ${e.message}`);
  try { await client.logout(); } catch { /* ignore */ }
  process.exit(1);
}
