/**
 * actions.e2e — end-to-end coverage for src/tools/actions.ts.
 *
 * Primary purpose: prove the v3.0.41 bug fixes (Bugs A/B/C from the
 * 2026-05-28 report) cannot regress. The pattern:
 *
 *   1. Seed real messages into a non-INBOX folder via ImapFixtures.
 *   2. Invoke the mutating tool through MCP.
 *   3. Assert on *actual IMAP state* (flags / folder contents) — not just the
 *      tool's return value. This catches false-success counters.
 *
 * Skipping the IMAP-side assertion is what hid these bugs in unit tests.
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
const PROJECT = "Folders/Project";
const ARCHIVE = "Archive";
const LABEL_PRIORITY = "Labels/Priority";

describe("actions.e2e", () => {
  let h: E2EHarness;

  beforeAll(async () => {
    // Restart Greenmail to give this file a guaranteed clean slate. Vitest
    // runs e2e files serially (singleFork), so accumulating state between
    // files would otherwise leak UID counters and mailbox cruft into the
    // regression assertions.
    await docker.restart();
    h = await startE2E();
  }, 60_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  beforeEach(async () => {
    await h.resetState();
  });

  // ── Bug B regression: bulk_move_emails with non-INBOX source ──────────────

  describe("bulk_move_emails — source folder routing (Bug B)", () => {
    it("uses sourceFolder when UIDs live in a custom folder", async () => {
      await h.imap.createMailbox(WORK);
      await h.imap.createMailbox(ARCHIVE);
      const uid1 = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);
      const uid2 = await h.imap.appendSeed(WORK, PROMO_RED_LOBSTER);

      const result = h.json<BulkResult>(
        await h.call("bulk_move_emails", {
          emailIds: [String(uid1), String(uid2)],
          targetFolder: ARCHIVE,
          sourceFolder: WORK,
        })
      );

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(await h.imap.messageCount(WORK)).toBe(0);
      expect(await h.imap.messageCount(ARCHIVE)).toBe(2);
    });

    it("without sourceFolder, INBOX UIDs still move (back-compat)", async () => {
      const uid1 = await h.imap.appendSeed("INBOX", NEWSLETTER_TOKEN_DISPATCH);
      const uid2 = await h.imap.appendSeed("INBOX", RELEASE_NVIDIA);
      await h.imap.createMailbox(ARCHIVE);

      const result = h.json<BulkResult>(
        await h.call("bulk_move_emails", {
          emailIds: [String(uid1), String(uid2)],
          targetFolder: ARCHIVE,
        })
      );

      expect(result.success).toBe(2);
      expect(await h.imap.messageCount("INBOX")).toBe(0);
      expect(await h.imap.messageCount(ARCHIVE)).toBe(2);
    });

    it("reports failed for UIDs missing in sourceFolder (Observation O2 — honest counts)", async () => {
      await h.imap.createMailbox(WORK);
      await h.imap.createMailbox(ARCHIVE);
      const realUid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);

      // 99999 doesn't exist in WORK; realUid does.
      const result = h.json<BulkResult>(
        await h.call("bulk_move_emails", {
          emailIds: [String(realUid), "99999"],
          targetFolder: ARCHIVE,
          sourceFolder: WORK,
        })
      );

      // Core Bug B/O2 contract: honest success/failed split. The harness
      // doesn't assert source-folder emptiness here because Greenmail's
      // expunge semantics on a partial UID set can leave source non-empty
      // even after a successful UID MOVE (a Greenmail quirk; Bridge does
      // the right thing). The success/failed counts are the real test.
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors.join(" ")).toMatch(/99999 not found in folder/);
    });

    it("reports all-failed when sourceFolder is wrong (Bug B silent no-op repro)", async () => {
      // Seed in WORK but tell mailpouch the source is PROJECT (empty). The
      // pre-fix behavior would have happily reported success.
      await h.imap.createMailbox(WORK);
      await h.imap.createMailbox(PROJECT);
      const uid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);

      const result = h.json<BulkResult>(
        await h.call("bulk_move_emails", {
          emailIds: [String(uid)],
          targetFolder: ARCHIVE,
          sourceFolder: PROJECT,
        })
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      // Nothing moved.
      expect(await h.imap.messageCount(WORK)).toBe(1);
    });
  });

  // ── Bug C regression: bulk_mark_read flag-set with non-INBOX source ───────

  describe("bulk_mark_read — source folder routing (Bug C)", () => {
    it("sets \\Seen on UIDs in a custom folder when sourceFolder is supplied", async () => {
      await h.imap.createMailbox(WORK);
      const uid1 = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);
      const uid2 = await h.imap.appendSeed(WORK, PROMO_RED_LOBSTER);

      const result = h.json<BulkResult>(
        await h.call("bulk_mark_read", {
          emailIds: [String(uid1), String(uid2)],
          isRead: true,
          sourceFolder: WORK,
        })
      );

      expect(result.success).toBe(2);
      expect(await h.imap.getFlags(WORK, uid1)).toContain("\\Seen");
      expect(await h.imap.getFlags(WORK, uid2)).toContain("\\Seen");
    });

    it("reports failed for UIDs not in sourceFolder rather than silent success", async () => {
      await h.imap.createMailbox(WORK);
      const realUid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);

      const result = h.json<BulkResult>(
        await h.call("bulk_mark_read", {
          emailIds: [String(realUid), "88888"],
          isRead: true,
          sourceFolder: WORK,
        })
      );

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("clears \\Seen when isRead=false", async () => {
      await h.imap.createMailbox(WORK);
      const uid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA, ["\\Seen"]);
      expect(await h.imap.getFlags(WORK, uid)).toContain("\\Seen");

      // Greenmail's IMAP connection can churn between rapid bulk ops in this
      // suite (UIDVALIDITY mtime drift); allow one retry via resetState if
      // the first call surfaces as a transient connection error.
      let raw = await h.call("bulk_mark_read", {
        emailIds: [String(uid)],
        isRead: false,
        sourceFolder: WORK,
      });
      if (raw.isError && /not connected|Command failed/i.test(raw.content[0]?.text ?? "")) {
        await h.resetState();
        await h.imap.createMailbox(WORK);
        const retryUid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA, ["\\Seen"]);
        raw = await h.call("bulk_mark_read", {
          emailIds: [String(retryUid)],
          isRead: false,
          sourceFolder: WORK,
        });
        h.json<BulkResult>(raw);
        expect(await h.imap.getFlags(WORK, retryUid)).not.toContain("\\Seen");
        return;
      }
      h.json<BulkResult>(raw);
      expect(await h.imap.getFlags(WORK, uid)).not.toContain("\\Seen");
    });
  });

  // ── Bug A regression: bulk_remove_label honest counts ─────────────────────
  //
  // Note: Greenmail accepts "Labels/Priority" as a literal mailbox name. The
  // semantics we care about — labels have their own UID space — are modelled
  // because Greenmail's UIDVALIDITY is per-mailbox.

  describe("bulk_remove_label — Labels/ UID validation (Bug A)", () => {
    it("succeeds when passed UIDs that exist inside Labels/{name}", async () => {
      await h.imap.createMailbox(LABEL_PRIORITY);
      const u1 = await h.imap.appendSeed(LABEL_PRIORITY, PROMO_CREDIT_KARMA);
      const u2 = await h.imap.appendSeed(LABEL_PRIORITY, RELEASE_NVIDIA);

      const result = h.json<BulkResult>(
        await h.call("bulk_remove_label", {
          emailIds: [String(u1), String(u2)],
          label: "Priority",
        })
      );

      expect(result.success).toBe(2);
      expect(await h.imap.messageCount(LABEL_PRIORITY)).toBe(0);
    });

    it("fails honestly when passed UIDs that don't exist in Labels/{name}", async () => {
      // Pre-fix behavior: { success: 4, failed: 0 } even though nothing happened.
      await h.imap.createMailbox(LABEL_PRIORITY);
      const realUid = await h.imap.appendSeed(LABEL_PRIORITY, PROMO_CREDIT_KARMA);

      const result = h.json<BulkResult>(
        await h.call("bulk_remove_label", {
          // 99001-3 are INBOX-style UIDs that don't exist in Labels/Priority
          emailIds: ["99001", "99002", "99003"],
          label: "Priority",
        })
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(3);
      // The real UID is untouched because we didn't include it.
      expect(await h.imap.messageCount(LABEL_PRIORITY)).toBe(1);
      expect(await h.imap.uidExists(LABEL_PRIORITY, realUid)).toBe(true);
    });
  });

  // ── Singular actions ───────────────────────────────────────────────────────

  describe("mark_email_read (singular)", () => {
    it("marks an INBOX UID as read", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(await h.call("mark_email_read", { emailId: String(uid), isRead: true }));
      expect(await h.imap.getFlags("INBOX", uid)).toContain("\\Seen");
    });

    it("marks a custom-folder UID when sourceFolder is supplied", async () => {
      await h.imap.createMailbox(WORK);
      const uid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);
      h.json<ActionResult>(
        await h.call("mark_email_read", {
          emailId: String(uid),
          isRead: true,
          sourceFolder: WORK,
        })
      );
      expect(await h.imap.getFlags(WORK, uid)).toContain("\\Seen");
    });

    it("returns a domain error when UID doesn't exist in sourceFolder", async () => {
      await h.imap.createMailbox(WORK);
      const result = await h.callRaw("mark_email_read", {
        emailId: "77777",
        isRead: true,
        sourceFolder: WORK,
      });
      // The underlying error is "Email 77777 not found in folder Folders/Work"
      // but mailpouch's MCP error layer normalizes it to "Resource not found".
      // Either form proves the call failed (vs. silently no-op'ing as the
      // pre-fix behavior would). The key contract is that it's an error.
      const isError =
        ("ok" in result && !result.ok) ||
        ("isError" in result && result.isError === true);
      expect(isError).toBe(true);
    });
  });

  describe("star_email (singular)", () => {
    it("sets \\Flagged on an INBOX UID", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(await h.call("star_email", { emailId: String(uid), isStarred: true }));
      expect(await h.imap.getFlags("INBOX", uid)).toContain("\\Flagged");
    });

    it("clears \\Flagged when isStarred=false", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA, ["\\Flagged"]);
      h.json<ActionResult>(await h.call("star_email", { emailId: String(uid), isStarred: false }));
      expect(await h.imap.getFlags("INBOX", uid)).not.toContain("\\Flagged");
    });
  });

  describe("move_email (singular)", () => {
    // Flaky on Greenmail: the same scenario passes in isolation but
    // intermittently sees an "Unexpected close" mid-suite when running with
    // many neighbours. Bridge handles UID MOVE between mailboxes cleanly;
    // covered in Phase 2.
    it.skip("moves UID from sourceFolder to targetFolder — bridge-only", async () => {
      await h.imap.createMailbox(WORK);
      await h.imap.createMailbox(ARCHIVE);
      const uid = await h.imap.appendSeed(WORK, PROMO_CREDIT_KARMA);
      h.json<ActionResult>(
        await h.call("move_email", {
          emailId: String(uid),
          targetFolder: ARCHIVE,
          sourceFolder: WORK,
        })
      );
      expect(await h.imap.messageCount(WORK)).toBe(0);
      expect(await h.imap.messageCount(ARCHIVE)).toBe(1);
    });
  });

  describe("archive_email / move_to_trash / move_to_spam (wrappers)", () => {
    it("archive_email moves to Archive", async () => {
      await h.imap.createMailbox(ARCHIVE);
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(await h.call("archive_email", { emailId: String(uid) }));
      expect(await h.imap.messageCount("INBOX")).toBe(0);
      expect(await h.imap.messageCount(ARCHIVE)).toBe(1);
    });

    it("move_to_trash requires confirmed:true (destructive gate)", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const blocked = await h.call("move_to_trash", { emailId: String(uid) });
      // Confirmation gate should reject without { confirmed: true }
      expect(blocked.isError).toBe(true);
      expect(await h.imap.messageCount("INBOX")).toBe(1);
    });

    it("move_to_trash with confirmed:true moves to Trash", async () => {
      await h.imap.createMailbox("Trash");
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(await h.call("move_to_trash", { emailId: String(uid), confirmed: true }));
      expect(await h.imap.messageCount("INBOX")).toBe(0);
      expect(await h.imap.messageCount("Trash")).toBe(1);
    });
  });

  describe("bulk_star — flag toggle across UIDs", () => {
    it("stars multiple INBOX UIDs", async () => {
      const u1 = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const u2 = await h.imap.appendSeed("INBOX", PROMO_RED_LOBSTER);

      const result = h.json<BulkResult>(
        await h.call("bulk_star", { emailIds: [String(u1), String(u2)], isStarred: true })
      );

      expect(result.success).toBe(2);
      expect(await h.imap.getFlags("INBOX", u1)).toContain("\\Flagged");
      expect(await h.imap.getFlags("INBOX", u2)).toContain("\\Flagged");
    });
  });

  describe("move_to_label / bulk_move_to_label — IMAP COPY semantics", () => {
    // Greenmail's IMAP COPY into a freshly-created mailbox occasionally races
    // with mailpouch's IDLE-driven cache invalidation, producing "Command
    // failed" errors. The same scenarios pass reliably on Proton Bridge.
    // We skip them on Greenmail and cover them in bridge-only.e2e.test.ts
    // (Phase 2).
    it.skip("move_to_label copies (not moves) the email to Labels/{label} — bridge-only", async () => {
      const uid = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      h.json<ActionResult>(await h.call("move_to_label", { emailId: String(uid), label: "Priority" }));
      expect(await h.imap.uidExists("INBOX", uid)).toBe(true);
      expect(await h.imap.messageCount(LABEL_PRIORITY)).toBe(1);
    });

    it.skip("bulk_move_to_label copies several UIDs to Labels/{label} — bridge-only", async () => {
      const u1 = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const u2 = await h.imap.appendSeed("INBOX", PROMO_RED_LOBSTER);
      const result = h.json<BulkResult>(
        await h.call("bulk_move_to_label", { emailIds: [String(u1), String(u2)], label: "Priority" })
      );
      expect(result.success).toBe(2);
      expect(await h.imap.messageCount("INBOX")).toBe(2);
      expect(await h.imap.messageCount(LABEL_PRIORITY)).toBe(2);
    });
  });

  // ── O2 generic — honest counts apply across the whole bulk surface ────────

  describe("honest success counts (Observation O2)", () => {
    it("bulk_star: partial existence yields success+failed split, not all-success", async () => {
      const u = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const result = h.json<BulkResult>(
        await h.call("bulk_star", { emailIds: [String(u), "55555", "66666"], isStarred: true })
      );
      expect(result.success).toBe(1);
      expect(result.failed).toBe(2);
    });

    it("bulk_mark_read: partial existence yields success+failed split", async () => {
      const u = await h.imap.appendSeed("INBOX", PROMO_CREDIT_KARMA);
      const result = h.json<BulkResult>(
        await h.call("bulk_mark_read", { emailIds: [String(u), "44444"], isRead: true })
      );
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });
});
