/**
 * Smoke test — proves the harness boots, mailpouch spawns + connects to
 * Greenmail, and basic IMAP fixtures round-trip cleanly. Every other
 * scenario file assumes these primitives work; if this fails, debug here
 * before chasing scenario-specific failures.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startE2E, type E2EHarness } from "../mcp-client.js";
import * as docker from "../support/docker.js";
import { PROMO_CREDIT_KARMA } from "../fixtures/seed-data.js";

describe("smoke.e2e — harness boots and round-trips", () => {
  let h: E2EHarness;

  beforeAll(async () => {
    await docker.up();
    h = await startE2E();
  }, 60_000);

  afterAll(async () => {
    if (h) {
      try { await h.imap.wipe(); } catch { /* container may already be gone */ }
      await h.close();
    }
  });

  beforeEach(async () => {
    await h.resetState();
  });

  it("MCP listTools returns the mailpouch tool surface", async () => {
    const { tools } = await h.client.listTools();
    const names = new Set(tools.map((t) => t.name));
    // Sample assertions across categories.
    expect(names.has("get_emails")).toBe(true);
    expect(names.has("bulk_move_emails")).toBe(true);
    expect(names.has("delete_email")).toBe(true);
    expect(names.has("get_folders")).toBe(true);
  });

  it("ImapFixtures APPEND + listUids round-trips", async () => {
    const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
    expect(uid).toBeGreaterThan(0);
    const uids = await h.imap.listUids("INBOX");
    expect(uids).toContain(uid);
  });

  it("mailpouch get_folders sees INBOX", async () => {
    const result = h.json<{ folders: { path: string }[] }>(await h.call("get_folders"));
    const paths = result.folders.map((f) => f.path);
    expect(paths).toContain("INBOX");
  });

  it("mailpouch get_email_by_id fetches a seeded message", async () => {
    // Read-after-write through mailpouch validates the full path:
    // ImapFixtures.append → mailpouch IMAP fetch → MCP response. Using
    // get_email_by_id (which does a fresh UID FETCH) sidesteps the
    // mailbox-EXISTS cache lag that get_emails can hit on Greenmail.
    const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
    await h.call("clear_cache");
    const result = h.json<{ subject: string }>(
      await h.call("get_email_by_id", { emailId: String(uid), folder: "INBOX" })
    );
    expect(result.subject).toBe(PROMO_CREDIT_KARMA.subject);
  });
});
