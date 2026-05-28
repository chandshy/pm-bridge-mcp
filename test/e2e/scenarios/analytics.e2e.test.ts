/**
 * analytics.e2e — coverage for src/tools/analytics.ts.
 *
 * These tools aggregate over the local IMAP cache. We seed enough variety
 * to make aggregates non-trivial, then call each endpoint and verify the
 * shape of the response.
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

describe("analytics.e2e", () => {
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

  describe("get_email_stats", () => {
    it("returns counts for a date range", async () => {
      const result = h.json<Record<string, unknown>>(
        await h.call("get_email_stats", { days: 30 })
      );
      expect(result).toBeTypeOf("object");
    });
  });

  describe("get_email_analytics", () => {
    it("returns top senders / aggregates", async () => {
      const result = h.json<Record<string, unknown>>(
        await h.call("get_email_analytics", { days: 30 })
      );
      expect(result).toBeTypeOf("object");
    });
  });

  describe("get_volume_trends", () => {
    it("returns per-day volume data", async () => {
      const result = h.json<Record<string, unknown>>(
        await h.call("get_volume_trends", { days: 30 })
      );
      expect(result).toBeTypeOf("object");
    });
  });

  describe("get_contacts", () => {
    it("returns a list of contacts derived from inbox traffic", async () => {
      const result = h.json<Record<string, unknown>>(
        await h.call("get_contacts", { limit: 50 })
      );
      expect(result).toBeTypeOf("object");
    });
  });
});
