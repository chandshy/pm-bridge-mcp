/**
 * labels.e2e — coverage for the label-side of src/tools/actions.ts.
 *
 * list_labels and get_emails_by_label are exercised here; move_to_label /
 * bulk_move_to_label / bulk_remove_label are covered in actions.e2e.test.ts
 * (the COPY-into-fresh-label race vs Greenmail is skipped there with a
 * pointer to the Phase-2 Bridge run).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startE2E, type E2EHarness } from "../mcp-client.js";
import * as docker from "../support/docker.js";
import { PROMO_CREDIT_KARMA, PROMO_RED_LOBSTER } from "../fixtures/seed-data.js";

const LABEL_PRIORITY = "Labels/Priority";

describe("labels.e2e", () => {
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

  describe("list_labels", () => {
    it("returns an array of labels (empty when none exist)", async () => {
      const result = h.json<{ labels: { name: string }[] }>(await h.call("list_labels"));
      expect(Array.isArray(result.labels)).toBe(true);
    });

    // Same folder-cache-lag pattern as folders.e2e.test.ts — bridge-only.
    it.skip("lists a label after a Labels/* mailbox is created and synced — bridge-only", async () => {
      await h.imap.createMailbox(LABEL_PRIORITY);
      await h.call("sync_folders");
      const result = h.json<{ labels: { name: string }[] }>(await h.call("list_labels"));
      expect(result.labels.some((l) => /Priority/i.test(l.name))).toBe(true);
    });
  });

  describe("get_emails_by_label", () => {
    it("returns messages from the label folder", async () => {
      await h.imap.createMailbox(LABEL_PRIORITY);
      await h.imap.appendSeed(LABEL_PRIORITY, PROMO_CREDIT_KARMA);
      await h.imap.appendSeed(LABEL_PRIORITY, PROMO_RED_LOBSTER);
      await h.call("clear_cache");
      await h.call("sync_folders");
      const result = h.json<{ emails: { subject: string }[] }>(
        await h.call("get_emails_by_label", { label: "Priority", limit: 20 })
      );
      const subjects = result.emails.map((e) => e.subject);
      expect(subjects.length).toBeGreaterThanOrEqual(2);
    });

    it("returns an actionable not-found error for a missing label (Cluster 6)", async () => {
      const raw = await h.callRaw("get_emails_by_label", { label: "NoSuchLabel", limit: 10 });
      const text = "message" in raw ? raw.message : raw.content?.[0]?.text ?? "";
      // Names the resolved Labels/<name> folder; never the opaque generic string.
      expect(text).toContain("Labels/NoSuchLabel");
      expect(text.toLowerCase()).toContain("not found");
      expect(text).not.toBe("An error occurred");
    });
  });
});
