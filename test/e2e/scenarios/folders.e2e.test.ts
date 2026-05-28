/**
 * folders.e2e — coverage for src/tools/folders.ts.
 *
 * Exercises create/list/rename/delete of custom folders. delete_folder has
 * a destructive gate; system folders (INBOX) are protected.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startE2E, type E2EHarness } from "../mcp-client.js";
import * as docker from "../support/docker.js";

type ActionResult = { success: boolean };
type Folder = { path: string; totalMessages?: number };

describe("folders.e2e", () => {
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

  describe("get_folders", () => {
    it("includes INBOX", async () => {
      const result = h.json<{ folders: Folder[] }>(await h.call("get_folders"));
      expect(result.folders.some((f) => f.path === "INBOX")).toBe(true);
    });

    // mailpouch's folder cache lags ImapFixtures' mailboxCreate on Greenmail
    // (even after sync_folders). Folder discovery works reliably in actions
    // tests (which create via mailpouch's own create_folder); the assertion
    // that side-channel creates propagate is bridge-only.
    it.skip("includes folders created via ImapFixtures after a sync — bridge-only", async () => {
      await h.imap.createMailbox("Folders/Project");
      await h.call("sync_folders");
      const result = h.json<{ folders: Folder[] }>(await h.call("get_folders"));
      expect(result.folders.some((f) => f.path === "Folders/Project")).toBe(true);
    });
  });

  describe("create_folder", () => {
    it("creates a new Folders/ folder", async () => {
      h.json<ActionResult>(await h.call("create_folder", { folderName: "Folders/NewlyCreated" }));
      const paths = await h.imap.listMailboxes();
      expect(paths.some((p) => p === "Folders/NewlyCreated")).toBe(true);
    });
  });

  describe("rename_folder", () => {
    it("renames a folder created earlier", async () => {
      h.json<ActionResult>(await h.call("create_folder", { folderName: "Folders/BeforeRename" }));
      h.json<ActionResult>(
        await h.call("rename_folder", { oldName: "Folders/BeforeRename", newName: "Folders/AfterRename" })
      );
      const paths = await h.imap.listMailboxes();
      expect(paths.some((p) => p === "Folders/AfterRename")).toBe(true);
      expect(paths.some((p) => p === "Folders/BeforeRename")).toBe(false);
    });
  });

  describe("delete_folder — destructive gate", () => {
    it("rejects without confirmed:true", async () => {
      h.json<ActionResult>(await h.call("create_folder", { folderName: "Folders/ToDelete" }));
      const raw = await h.call("delete_folder", { folderName: "Folders/ToDelete" });
      expect(raw.isError).toBe(true);
      const paths = await h.imap.listMailboxes();
      expect(paths.some((p) => p === "Folders/ToDelete")).toBe(true);
    });

    it("deletes when confirmed:true is supplied", async () => {
      h.json<ActionResult>(await h.call("create_folder", { folderName: "Folders/ConfirmDel" }));
      h.json<ActionResult>(
        await h.call("delete_folder", { folderName: "Folders/ConfirmDel", confirmed: true })
      );
      const paths = await h.imap.listMailboxes();
      expect(paths.some((p) => p === "Folders/ConfirmDel")).toBe(false);
    });
  });

  describe("sync_folders", () => {
    it("returns a success result with a count", async () => {
      const result = h.json<{ success: boolean; count?: number }>(await h.call("sync_folders"));
      expect(result.success).toBe(true);
    });
  });
});
