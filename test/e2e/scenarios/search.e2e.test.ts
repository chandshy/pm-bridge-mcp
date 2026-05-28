/**
 * search.e2e — coverage for search_emails (IMAP server search) and the FTS
 * tools (fts_search / fts_rebuild / fts_status).
 *
 * Greenmail's IMAP SEARCH supports the standard criteria; we exercise the
 * common subset. FTS tools operate on the local cache, so we seed + sync
 * before any FTS assertions.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startE2E, type E2EHarness } from "../mcp-client.js";
import * as docker from "../support/docker.js";
import {
  NEWSLETTER_TOKEN_DISPATCH,
  PROMO_BATCH,
  PROMO_CREDIT_KARMA,
  RELEASE_NVIDIA,
} from "../fixtures/seed-data.js";

describe("search.e2e", () => {
  let h: E2EHarness;

  beforeAll(async () => {
    await docker.restart();
    h = await startE2E();
  }, 60_000);

  afterAll(async () => {
    if (h) {
      try { await h.imap.wipe(); } catch { /* ignore */ }
      await h.close();
    }
  });

  beforeEach(async () => {
    await h.resetState();
    for (const seed of PROMO_BATCH) await h.imap.appendSeed("INBOX", seed);
    await h.call("clear_cache");
    await h.call("sync_emails", { folder: "INBOX", limit: 20 });
  });

  describe("search_emails", () => {
    it("finds seeded INBOX messages by subject substring", async () => {
      const result = h.json<{ emails: { subject: string }[] }>(
        await h.call("search_emails", { folder: "INBOX", subject: "credit" })
      );
      expect(result.emails.some((e) => /credit/i.test(e.subject))).toBe(true);
    });

    it("returns empty for a subject that doesn't match", async () => {
      const result = h.json<{ emails: unknown[] }>(
        await h.call("search_emails", { folder: "INBOX", subject: "nonexistent-needle-xyzqv" })
      );
      expect(result.emails.length).toBe(0);
    });

    // Greenmail's IMAP SEARCH FROM uses substring matching but its tokenization
    // differs from Bridge/Dovecot in some cases. Bridge-validated.
    it.skip("finds messages by from address — bridge-only", async () => {
      const result = h.json<{ emails: { subject: string }[] }>(
        await h.call("search_emails", { folder: "INBOX", from: "nvidia.com" })
      );
      expect(result.emails.some((e) => e.subject === RELEASE_NVIDIA.subject)).toBe(true);
    });
  });

  describe("fts_status", () => {
    it("returns the FTS index health metadata", async () => {
      const result = h.json<Record<string, unknown>>(await h.call("fts_status"));
      expect(result).toBeTypeOf("object");
    });
  });

  describe("fts_search", () => {
    it("returns a hits envelope even when the index is empty", async () => {
      const result = h.json<{ hits: unknown[] }>(
        await h.call("fts_search", { query: "credit", limit: 10 })
      );
      expect(Array.isArray(result.hits)).toBe(true);
    });
  });
});
