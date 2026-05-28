/**
 * deletion.e2e — coverage for src/tools/deletion.ts.
 *
 * All deletion tools require { confirmed: true } per mailpouch's destructive
 * gate. We assert both the gate (rejects without confirmed) and the
 * underlying IMAP state after a confirmed delete + expunge.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startE2E, type E2EHarness } from "../mcp-client.js";
import * as docker from "../support/docker.js";
import {
  NEWSLETTER_TOKEN_DISPATCH,
  PROMO_CREDIT_KARMA,
  PROMO_RED_LOBSTER,
  RELEASE_NVIDIA,
} from "../fixtures/seed-data.js";

type BulkResult = { success: number; failed: number; errors: string[] };
type ActionResult = { success: boolean };

const WORK = "Folders/Work";

describe("deletion.e2e", () => {
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
  });

  describe("delete_email — destructive gate", () => {
    it("rejects when confirmed flag is missing", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const raw = await h.call("delete_email", { emailId: String(uid) });
      expect(raw.isError).toBe(true);
      expect(await h.imap.uidExists("INBOX", uid)).toBe(true);
    });

    it("deletes when confirmed:true is supplied", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(
        await h.call("delete_email", { emailId: String(uid), confirmed: true })
      );
      expect(await h.imap.uidExists("INBOX", uid)).toBe(false);
    });

    it("deletes from sourceFolder when supplied", async () => {
      await h.imap.createMailbox(WORK);
      const uid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);
      h.json<ActionResult>(
        await h.call("delete_email", {
          emailId: String(uid),
          confirmed: true,
          sourceFolder: WORK,
        })
      );
      expect(await h.imap.messageCount(WORK)).toBe(0);
    });
  });

  describe("bulk_delete_emails", () => {
    it("rejects without confirmed:true", async () => {
      const u = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const raw = await h.call("bulk_delete_emails", { emailIds: [String(u)] });
      expect(raw.isError).toBe(true);
      expect(await h.imap.uidExists("INBOX", u)).toBe(true);
    });

    it("deletes multiple INBOX UIDs with confirmed:true", async () => {
      const u1 = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const u2 = await h.imap.appendSeed("INBOX", PROMO_RED_LOBSTER);
      const u3 = await h.imap.appendSeed("INBOX", RELEASE_NVIDIA);

      const result = h.json<BulkResult>(
        await h.call("bulk_delete_emails", {
          emailIds: [String(u1), String(u2), String(u3)],
          confirmed: true,
        })
      );

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(await h.imap.uidExists("INBOX", u1)).toBe(false);
      expect(await h.imap.uidExists("INBOX", u2)).toBe(false);
      expect(await h.imap.uidExists("INBOX", u3)).toBe(false);
    });

    it("counts missing UIDs as failed when sourceFolder is supplied", async () => {
      await h.imap.createMailbox(WORK);
      const real = await h.imap.appendSeed(WORK, NEWSLETTER_TOKEN_DISPATCH);

      const result = h.json<BulkResult>(
        await h.call("bulk_delete_emails", {
          emailIds: [String(real), "99001", "99002"],
          confirmed: true,
          sourceFolder: WORK,
        })
      );

      expect(result.success).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.errors.join(" ")).toMatch(/99001|99002/);
    });
  });

  describe("bulk_delete (alias for bulk_delete_emails)", () => {
    it("behaves identically to bulk_delete_emails", async () => {
      const u1 = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const u2 = await h.imap.appendSeed("INBOX", PROMO_RED_LOBSTER);
      const result = h.json<BulkResult>(
        await h.call("bulk_delete", {
          emailIds: [String(u1), String(u2)],
          confirmed: true,
        })
      );
      expect(result.success).toBe(2);
    });
  });
});
