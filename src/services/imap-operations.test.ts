/**
 * Tests for SimpleIMAPService email operation methods:
 *   - markEmailRead / starEmail
 *   - moveEmail / copyEmailToFolder
 *   - deleteFromFolder / deleteEmail
 *   - setFlag
 *   - bulkMoveEmails / bulkDeleteEmails
 *   - clearCache
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimpleIMAPService } from "./simple-imap-service.js";
import type { EmailMessage } from "../types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEmail(id: string, folder = "INBOX"): EmailMessage {
  return {
    id,
    folder,
    from: "sender@example.com",
    to: ["recipient@example.com"],
    subject: "Test Subject",
    body: "Test body",
    date: new Date(),
    isRead: false,
    isStarred: false,
    hasAttachment: false,
    isHtml: false,
  };
}

function makeLock() {
  return { release: vi.fn() };
}

function makeClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    messageFlagsRemove: vi.fn().mockResolvedValue(undefined),
    messageMove: vi.fn().mockResolvedValue(undefined),
    messageCopy: vi.fn().mockResolvedValue(undefined),
    messageDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function connectSvc(svc: SimpleIMAPService, clientOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  const client = makeClient(clientOverrides);
  (svc as any).isConnected = true;
  (svc as any).client = client;
  return client;
}

// ─── markEmailRead ────────────────────────────────────────────────────────────

describe("SimpleIMAPService.markEmailRead", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    const result = await svc.markEmailRead("1", true);
    expect(result).toBe(false);
  });

  it("marks email as read (adds \\Seen flag)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    const email = makeEmail("42");
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    const result = await svc.markEmailRead("42", true);

    expect(result).toBe(true);
    expect(client.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Seen"], { uid: true });
    expect(client.messageFlagsRemove).not.toHaveBeenCalled();
  });

  it("marks email as unread (removes \\Seen flag)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    const email = makeEmail("43");
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    const result = await svc.markEmailRead("43", false);

    expect(result).toBe(true);
    expect(client.messageFlagsRemove).toHaveBeenCalledWith("43", ["\\Seen"], { uid: true });
  });

  it("updates cache isRead when entry is present", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    const email = makeEmail("44");
    // Seed the cache
    (svc as any).setCacheEntry("44", email);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    await svc.markEmailRead("44", true);

    const cached = (svc as any).getCacheEntry("44");
    expect(cached?.isRead).toBe(true);
  });

  it("throws when email is not found", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    await expect(svc.markEmailRead("99")).rejects.toThrow("not found");
  });
});

// ─── starEmail ────────────────────────────────────────────────────────────────

describe("SimpleIMAPService.starEmail", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    expect(await svc.starEmail("1", true)).toBe(false);
  });

  it("stars email (adds \\Flagged flag)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(makeEmail("10"));

    const result = await svc.starEmail("10", true);

    expect(result).toBe(true);
    expect(client.messageFlagsAdd).toHaveBeenCalledWith("10", ["\\Flagged"], { uid: true });
  });

  it("unstars email (removes \\Flagged flag)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(makeEmail("11"));

    await svc.starEmail("11", false);

    expect(client.messageFlagsRemove).toHaveBeenCalledWith("11", ["\\Flagged"], { uid: true });
  });

  it("updates cache isStarred when entry is present", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    const email = makeEmail("12");
    (svc as any).setCacheEntry("12", email);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    await svc.starEmail("12", true);

    expect((svc as any).getCacheEntry("12")?.isStarred).toBe(true);
  });

  it("throws (re-throws) when getEmailById returns null", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    await expect(svc.starEmail("99")).rejects.toThrow("not found");
  });
});

// ─── moveEmail ────────────────────────────────────────────────────────────────

describe("SimpleIMAPService.moveEmail", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    expect(await svc.moveEmail("1", "Trash")).toBe(false);
  });

  it("moves email and returns true", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(makeEmail("20", "INBOX"));

    const result = await svc.moveEmail("20", "Trash");

    expect(result).toBe(true);
    expect(client.messageMove).toHaveBeenCalledWith("20", "Trash", { uid: true });
  });

  it("updates cache folder when entry is present", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    const email = makeEmail("21", "INBOX");
    (svc as any).setCacheEntry("21", email);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    await svc.moveEmail("21", "Sent");

    expect((svc as any).getCacheEntry("21")?.folder).toBe("Sent");
  });

  it("throws when email not found", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    await expect(svc.moveEmail("999", "Trash")).rejects.toThrow("not found");
  });
});

// ─── copyEmailToFolder ────────────────────────────────────────────────────────

describe("SimpleIMAPService.copyEmailToFolder", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    expect(await svc.copyEmailToFolder("1", "Labels/Work")).toBe(false);
  });

  it("copies email and returns true", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(makeEmail("30", "INBOX"));

    const result = await svc.copyEmailToFolder("30", "Labels/Work");

    expect(result).toBe(true);
    expect(client.messageCopy).toHaveBeenCalledWith("30", "Labels/Work", { uid: true });
  });

  it("throws when email not found", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    await expect(svc.copyEmailToFolder("888", "Labels/Work")).rejects.toThrow("not found");
  });
});

// ─── deleteFromFolder ─────────────────────────────────────────────────────────

describe("SimpleIMAPService.deleteFromFolder", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    expect(await svc.deleteFromFolder("1", "INBOX")).toBe(false);
  });

  it("deletes email from folder and returns true", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);

    const result = await svc.deleteFromFolder("50", "INBOX");

    expect(result).toBe(true);
    expect(client.messageDelete).toHaveBeenCalledWith("50", { uid: true });
  });

  it("evicts cache entry after deletion", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    (svc as any).setCacheEntry("51", makeEmail("51"));

    await svc.deleteFromFolder("51", "INBOX");

    expect((svc as any).emailCache.has("51")).toBe(false);
  });

  it("throws when messageDelete fails", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc, { messageDelete: vi.fn().mockRejectedValue(new Error("EXPUNGED")) });

    await expect(svc.deleteFromFolder("52", "INBOX")).rejects.toThrow("EXPUNGED");
  });
});

// ─── deleteEmail ──────────────────────────────────────────────────────────────

describe("SimpleIMAPService.deleteEmail", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    expect(await svc.deleteEmail("1")).toBe(false);
  });

  it("deletes email and returns true", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(makeEmail("60"));

    const result = await svc.deleteEmail("60");

    expect(result).toBe(true);
    expect(client.messageDelete).toHaveBeenCalledWith("60", { uid: true });
  });

  it("evicts email from cache after deletion", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    const email = makeEmail("61");
    (svc as any).setCacheEntry("61", email);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(email);

    await svc.deleteEmail("61");

    expect((svc as any).emailCache.has("61")).toBe(false);
  });

  it("throws when email not found", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc, "getEmailById").mockResolvedValue(null);

    await expect(svc.deleteEmail("777")).rejects.toThrow("not found");
  });
});

// ─── setFlag ──────────────────────────────────────────────────────────────────

describe("SimpleIMAPService.setFlag", () => {
  it("returns false when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => {});
    expect(await svc.setFlag("1", "\\Answered")).toBe(false);
  });

  it("adds flag using cached folder (avoids scanning all folders)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    // Seed the cache so setFlag can find the folder without scanning
    (svc as any).setCacheEntry("70", makeEmail("70", "INBOX"));

    const result = await svc.setFlag("70", "\\Answered", true);

    expect(result).toBe(true);
    expect(client.messageFlagsAdd).toHaveBeenCalledWith("70", ["\\Answered"], { uid: true });
    // Should have locked the folder from cache, not scanned all folders
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("removes flag when set=false", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    (svc as any).setCacheEntry("71", makeEmail("71", "Sent"));

    await svc.setFlag("71", "$Forwarded", false);

    expect(client.messageFlagsRemove).toHaveBeenCalledWith("71", ["$Forwarded"], { uid: true });
  });

  it("throws when email is not in cache and getFolders returns no match", async () => {
    const svc = new SimpleIMAPService();
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
      messageFlagsRemove: vi.fn().mockResolvedValue(undefined),
    };
    (svc as any).isConnected = true;
    (svc as any).client = client;
    vi.spyOn(svc, "getFolders").mockResolvedValue([]);

    await expect(svc.setFlag("999", "\\Answered")).rejects.toThrow("not found in any folder");
  });

  it("finds email via folder scan and sets flag (email not in cache)", async () => {
    const svc = new SimpleIMAPService();
    // Email NOT in cache — setFlag will scan all folders
    const emailId = "77";
    const mockLock = makeLock();
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
      messageFlagsRemove: vi.fn().mockResolvedValue(undefined),
      // fetch returns an async generator yielding a message with matching UID
      fetch: vi.fn().mockReturnValue(asyncMessages([{ uid: 77 }])),
    };
    (svc as any).isConnected = true;
    (svc as any).client = client;
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 1, unreadMessages: 0, folderType: "system" as const },
    ]);

    const result = await svc.setFlag(emailId, "\\Answered", true);

    expect(result).toBe(true);
    expect(client.messageFlagsAdd).toHaveBeenCalledWith(emailId, ["\\Answered"], { uid: true });
  });

  it("handles fetch throwing in folder scan (catch swallows, continues to next folder)", async () => {
    const svc = new SimpleIMAPService();
    const emailId = "88";
    const mockLock = makeLock();
    async function* throwingFetch() { throw new Error("NOT IN THIS FOLDER"); }
    const client = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockReturnValue(throwingFetch()),
    };
    (svc as any).isConnected = true;
    (svc as any).client = client;
    // Only one folder, fetch throws, so email is not found → throws "not found in any folder"
    vi.spyOn(svc, "getFolders").mockResolvedValue([
      { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" as const },
    ]);

    await expect(svc.setFlag(emailId, "\\Answered")).rejects.toThrow("not found in any folder");
    // lock.release() must still have been called (finally block)
    expect(mockLock.release).toHaveBeenCalled();
  });
});

// ─── bulkMoveEmails ───────────────────────────────────────────────────────────

describe("SimpleIMAPService.bulkMoveEmails", () => {
  it("throws when not connected", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    await expect(svc.bulkMoveEmails(["1", "2"], "Trash")).rejects.toThrow("not connected");
  });

  it("batch-moves emails grouped by folder", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    // Seed two emails in INBOX
    (svc as any).setCacheEntry("80", makeEmail("80", "INBOX"));
    (svc as any).setCacheEntry("81", makeEmail("81", "INBOX"));

    const results = await svc.bulkMoveEmails(["80", "81"], "Trash");

    expect(results.success).toBe(2);
    expect(results.failed).toBe(0);
    // Batch move: the UID set is sent as a single messageMove call
    expect(client.messageMove).toHaveBeenCalledWith("80,81", "Trash", { uid: true });
    // Cache entries should have folder updated
    expect((svc as any).getCacheEntry("80")?.folder).toBe("Trash");
    expect((svc as any).getCacheEntry("81")?.folder).toBe("Trash");
  });

  it("falls back to per-email move when batch fails", async () => {
    const svc = new SimpleIMAPService();
    // Batch move fails, per-email move succeeds
    const client = connectSvc(svc, {
      messageMove: vi.fn()
        .mockRejectedValueOnce(new Error("batch error"))
        .mockResolvedValue(undefined),
    });
    (svc as any).setCacheEntry("82", makeEmail("82", "INBOX"));
    (svc as any).setCacheEntry("83", makeEmail("83", "INBOX"));

    const results = await svc.bulkMoveEmails(["82", "83"], "Trash");

    expect(results.success).toBe(2);
    expect(results.failed).toBe(0);
  });

  it("records per-email failure in fallback mode", async () => {
    const svc = new SimpleIMAPService();
    // Batch fails, then per-email also fails
    connectSvc(svc, {
      messageMove: vi.fn().mockRejectedValue(new Error("always fails")),
    });
    (svc as any).setCacheEntry("84", makeEmail("84", "INBOX"));

    const results = await svc.bulkMoveEmails(["84"], "Trash");

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toMatch(/always fails/);
  });

  it("counts invalid email IDs as failed immediately", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);

    // "not-a-uid" fails validateEmailId
    const results = await svc.bulkMoveEmails(["not-a-uid"], "Trash");

    expect(results.failed).toBe(1);
    expect(results.success).toBe(0);
  });

  it("falls back to INBOX when email not in cache (line 1526 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    // Email 95 is NOT in cache — folder defaults to 'INBOX'

    const results = await svc.bulkMoveEmails(["95"], "Archive");

    expect(results.success).toBe(1);
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });

  it("handles String() fallback when validateEmailId throws non-Error (line 1531 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => { throw 42; }); // non-Error

    const results = await svc.bulkMoveEmails(["99"], "Trash");

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toContain("42"); // String(42)
  });

  it("handles non-Error in per-email fallback (line 1559 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc, {
      messageMove: vi.fn()
        .mockRejectedValueOnce(new Error("batch fail")) // batch fails
        .mockRejectedValueOnce("string error"),          // per-email fails with non-Error
    });
    (svc as any).setCacheEntry("96", makeEmail("96", "INBOX"));

    const results = await svc.bulkMoveEmails(["96"], "Trash");

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toContain("string error"); // String("string error")
  });

  it("skips cache update when email not in cache after successful batch move (line 1545 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    // Email 97 is NOT in cache — after successful move, no cache update needed

    const results = await svc.bulkMoveEmails(["97"], "Archive");

    expect(results.success).toBe(1);
    // No crash — getCacheEntry returned null and the if(cachedForBulkMove) was false
  });
});

// ─── bulkDeleteEmails ─────────────────────────────────────────────────────────

describe("SimpleIMAPService.bulkDeleteEmails", () => {
  it("throws when not connected", async () => {
    const svc = new SimpleIMAPService();
    await expect(svc.bulkDeleteEmails(["1"])).rejects.toThrow("not connected");
  });

  it("batch-deletes emails grouped by folder", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    (svc as any).setCacheEntry("90", makeEmail("90", "INBOX"));
    (svc as any).setCacheEntry("91", makeEmail("91", "INBOX"));

    const results = await svc.bulkDeleteEmails(["90", "91"]);

    expect(results.success).toBe(2);
    expect(results.failed).toBe(0);
    expect(client.messageDelete).toHaveBeenCalledWith("90,91", { uid: true });
    // Cache entries should be evicted
    expect((svc as any).emailCache.has("90")).toBe(false);
    expect((svc as any).emailCache.has("91")).toBe(false);
  });

  it("falls back to per-email delete when batch fails", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc, {
      messageDelete: vi.fn()
        .mockRejectedValueOnce(new Error("batch error"))
        .mockResolvedValue(undefined),
    });
    (svc as any).setCacheEntry("92", makeEmail("92", "INBOX"));
    (svc as any).setCacheEntry("93", makeEmail("93", "INBOX"));

    const results = await svc.bulkDeleteEmails(["92", "93"]);

    expect(results.success).toBe(2);
    expect(results.failed).toBe(0);
  });

  it("records per-email failure in fallback mode", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc, {
      messageDelete: vi.fn().mockRejectedValue(new Error("EXPUNGED")),
    });
    (svc as any).setCacheEntry("94", makeEmail("94", "INBOX"));

    const results = await svc.bulkDeleteEmails(["94"]);

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toMatch(/EXPUNGED/);
  });

  it("counts invalid email IDs as failed immediately", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);

    const results = await svc.bulkDeleteEmails(["not-a-uid"]);

    expect(results.failed).toBe(1);
    expect(results.success).toBe(0);
  });

  it("handles String() fallback when validateEmailId throws non-Error (line 1640 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc);
    vi.spyOn(svc as any, "validateEmailId").mockImplementation(() => { throw { code: 99 }; }); // non-Error

    const results = await svc.bulkDeleteEmails(["99"]);

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toContain("[object Object]"); // String({code:99})
  });

  it("handles non-Error in per-email delete fallback (line 1665 branch 1)", async () => {
    const svc = new SimpleIMAPService();
    connectSvc(svc, {
      messageDelete: vi.fn()
        .mockRejectedValueOnce(new Error("batch fail"))
        .mockRejectedValueOnce("delete-error-string"),
    });
    (svc as any).setCacheEntry("96", makeEmail("96", "INBOX"));

    const results = await svc.bulkDeleteEmails(["96"]);

    expect(results.failed).toBe(1);
    expect(results.errors[0]).toContain("delete-error-string");
  });

  it("falls back to INBOX folder for emails not in cache", async () => {
    const svc = new SimpleIMAPService();
    const client = connectSvc(svc);
    // Email "95" is NOT in cache — should default to INBOX
    // messageDelete resolves successfully

    const results = await svc.bulkDeleteEmails(["95"]);

    expect(results.success).toBe(1);
    expect(client.getMailboxLock).toHaveBeenCalledWith("INBOX");
  });
});

// ─── countAttachments (private) ───────────────────────────────────────────────

describe("SimpleIMAPService private countAttachments", () => {
  it("returns 0 for null/undefined structure", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).countAttachments(null)).toBe(0);
    expect((svc as any).countAttachments(undefined)).toBe(0);
  });

  it("recurses into childNodes for multipart structures", () => {
    const svc = new SimpleIMAPService();
    const structure = {
      childNodes: [
        { disposition: "attachment" }, // 1 attachment
        { type: "text" },              // not an attachment
      ],
    };
    expect((svc as any).countAttachments(structure)).toBe(1);
  });

  it("returns 1 for a leaf node with disposition=attachment", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).countAttachments({ disposition: "attachment" })).toBe(1);
  });

  it("returns 1 for a leaf node with non-text, non-multipart type", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).countAttachments({ type: "image", subtype: "png" })).toBe(1);
  });

  it("returns 0 for a leaf node with type=text", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).countAttachments({ type: "text" })).toBe(0);
  });

  it("returns 0 for a leaf node with empty type", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).countAttachments({ type: "" })).toBe(0);
  });
});

// ─── extractAttachmentMeta (private) ──────────────────────────────────────────

describe("SimpleIMAPService private extractAttachmentMeta", () => {
  it("returns [] for null/undefined structure", () => {
    const svc = new SimpleIMAPService();
    expect((svc as any).extractAttachmentMeta(null)).toEqual([]);
    expect((svc as any).extractAttachmentMeta(undefined)).toEqual([]);
  });

  it("recurses into childNodes and collects attachments", () => {
    const svc = new SimpleIMAPService();
    const structure = {
      childNodes: [
        { disposition: "attachment", dispositionParameters: { filename: "file.pdf" }, type: "application", subtype: "pdf", size: 1024 },
        { type: "text" },
      ],
    };
    const result = (svc as any).extractAttachmentMeta(structure);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("file.pdf");
    expect(result[0].contentType).toBe("application/pdf");
    expect(result[0].size).toBe(1024);
  });

  it("uses parameters.name as fallback filename", () => {
    const svc = new SimpleIMAPService();
    const structure = {
      disposition: "attachment",
      parameters: { name: "doc.txt" },
      type: "text",
      subtype: "plain",
      size: 100,
    };
    const result = (svc as any).extractAttachmentMeta(structure);
    expect(result[0].filename).toBe("doc.txt");
  });

  it("uses 'unnamed' when no filename available", () => {
    const svc = new SimpleIMAPService();
    const result = (svc as any).extractAttachmentMeta({ disposition: "attachment", type: "application", size: 50 });
    expect(result[0].filename).toBe("unnamed");
    expect(result[0].contentType).toBe("application/*"); // subtype ?? '*'
  });

  it("uses contentId from id field", () => {
    const svc = new SimpleIMAPService();
    const result = (svc as any).extractAttachmentMeta({ disposition: "attachment", type: "image", id: "<cid@example>", size: 0 });
    expect(result[0].contentId).toBe("<cid@example>");
  });

  it("falls back to application/octet-stream when type is missing", () => {
    const svc = new SimpleIMAPService();
    const result = (svc as any).extractAttachmentMeta({ disposition: "attachment", size: 0 });
    expect(result[0].contentType).toBe("application/octet-stream");
  });

  it("does not classify multipart as attachment (line 274 branch 2)", () => {
    const svc = new SimpleIMAPService();
    // No disposition + type=multipart → isAttachment=false (type !== 'multipart' is false)
    const result = (svc as any).extractAttachmentMeta({ type: "multipart", size: 100 });
    expect(result).toEqual([]);
  });

  it("does not classify empty-type as attachment (line 274 branch 3)", () => {
    const svc = new SimpleIMAPService();
    // No disposition + type='' → isAttachment=false (type !== '' is false)
    const result = (svc as any).extractAttachmentMeta({ type: "", size: 100 });
    expect(result).toEqual([]);
  });

  it("uses 0 as size when structure.size is undefined (line 283 branch 1)", () => {
    const svc = new SimpleIMAPService();
    // No size field → size ?? 0 = 0
    const result = (svc as any).extractAttachmentMeta({ disposition: "attachment", type: "application" });
    expect(result[0].size).toBe(0);
  });

  it("returns undefined contentId when structure.id is absent (line 283 branch 1 for id)", () => {
    const svc = new SimpleIMAPService();
    // No id field → contentId = undefined
    const result = (svc as any).extractAttachmentMeta({ disposition: "attachment", type: "application", size: 0 });
    expect(result[0].contentId).toBeUndefined();
  });
});

// ─── checkAndUpdateUidValidity (private) ──────────────────────────────────────

describe("SimpleIMAPService private checkAndUpdateUidValidity", () => {
  it("returns immediately when client has no mailbox", () => {
    const svc = new SimpleIMAPService();
    (svc as any).client = null;
    // Should not throw
    expect(() => (svc as any).checkAndUpdateUidValidity("INBOX")).not.toThrow();
  });

  it("returns immediately when mailbox is boolean", () => {
    const svc = new SimpleIMAPService();
    (svc as any).client = { mailbox: false };
    expect(() => (svc as any).checkAndUpdateUidValidity("INBOX")).not.toThrow();
  });

  it("returns immediately when uidValidity is undefined", () => {
    const svc = new SimpleIMAPService();
    (svc as any).client = { mailbox: { uidValidity: undefined } };
    expect(() => (svc as any).checkAndUpdateUidValidity("INBOX")).not.toThrow();
  });

  it("stores uidValidity on first access", () => {
    const svc = new SimpleIMAPService();
    (svc as any).client = { mailbox: { uidValidity: BigInt(1234) } };
    (svc as any).checkAndUpdateUidValidity("INBOX");
    expect((svc as any).uidValidityMap.get("INBOX")).toBe(BigInt(1234));
  });

  it("clears email cache when uidValidity changes", () => {
    const svc = new SimpleIMAPService();
    // Pre-seed the uidValidityMap with an old value
    (svc as any).uidValidityMap.set("INBOX", BigInt(100));
    (svc as any).client = { mailbox: { uidValidity: BigInt(999) } }; // new value
    // Seed the cache
    const email = makeEmail("300");
    (svc as any).setCacheEntry("300", email);
    expect((svc as any).emailCache.size).toBe(1);

    (svc as any).checkAndUpdateUidValidity("INBOX");

    // Cache should have been cleared
    expect((svc as any).emailCache.size).toBe(0);
    expect((svc as any).uidValidityMap.get("INBOX")).toBe(BigInt(999));
  });
});

// ─── clearCache ───────────────────────────────────────────────────────────────

describe("SimpleIMAPService.clearCache", () => {
  it("clears email cache and folder cache", () => {
    const svc = new SimpleIMAPService();
    // Seed some state
    const email = makeEmail("100");
    (svc as any).setCacheEntry("100", email);
    (svc as any).folderCache.set("INBOX", { name: "INBOX", path: "INBOX" });
    (svc as any).folderCachedAt = Date.now();

    svc.clearCache();

    expect((svc as any).emailCache.size).toBe(0);
    expect((svc as any).cacheByteEstimate).toBe(0);
    expect((svc as any).folderCache.size).toBe(0);
    expect((svc as any).folderCachedAt).toBe(0);
  });

  it("does not throw when caches are already empty", () => {
    const svc = new SimpleIMAPService();
    expect(() => svc.clearCache()).not.toThrow();
  });
});

// ─── getFolders ───────────────────────────────────────────────────────────────

describe("SimpleIMAPService.getFolders", () => {
  it("returns cached folders when cache is fresh", async () => {
    const svc = new SimpleIMAPService();
    // Seed folder cache with a fresh timestamp
    (svc as any).folderCache.set("INBOX", { name: "INBOX", path: "INBOX", totalMessages: 0, unreadMessages: 0, folderType: "system" });
    (svc as any).folderCachedAt = Date.now(); // freshly cached

    const folders = await svc.getFolders();

    expect(folders).toHaveLength(1);
    expect(folders[0].path).toBe("INBOX");
  });

  it("returns empty array when ensureConnection throws and cache is empty", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "ensureConnection").mockRejectedValue(new Error("no connection config"));

    const folders = await svc.getFolders();

    expect(folders).toEqual([]);
  });

  it("returns cached folders when ensureConnection throws and cache has data", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).folderCache.set("Sent", { name: "Sent", path: "Sent", totalMessages: 5, unreadMessages: 0, folderType: "system" });
    // Do NOT set folderCachedAt — it's 0, so cache age will be very large and TTL expired
    // but ensureConnection failure still returns the stale cache
    vi.spyOn(svc as any, "ensureConnection").mockRejectedValue(new Error("lost"));

    const folders = await svc.getFolders();

    expect(folders).toHaveLength(1);
    expect(folders[0].path).toBe("Sent");
  });

  it("returns empty array when client is null after ensureConnection", async () => {
    const svc = new SimpleIMAPService();
    // ensureConnection succeeds but client remains null
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    (svc as any).client = null;

    const folders = await svc.getFolders();

    expect(folders).toEqual([]);
  });

  it("fetches from IMAP when cache is empty and client is connected", async () => {
    const svc = new SimpleIMAPService();
    const mockStatus = { messages: 10, unseen: 2 };
    const mockClient = {
      list: vi.fn().mockResolvedValue([
        { path: "INBOX", name: "INBOX", delimiter: "/", flags: new Set(), specialUse: undefined },
        { path: "Labels/Work", name: "Work", delimiter: "/", flags: new Set(), specialUse: undefined },
      ]),
      status: vi.fn().mockResolvedValue(mockStatus),
    };
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    (svc as any).client = mockClient;

    const folders = await svc.getFolders();

    expect(folders).toHaveLength(2);
    const inbox = folders.find(f => f.path === "INBOX")!;
    expect(inbox.folderType).toBe("system");
    expect(inbox.totalMessages).toBe(10);
    expect(inbox.unreadMessages).toBe(2);
    const label = folders.find(f => f.path === "Labels/Work")!;
    expect(label.folderType).toBe("label");
  });

  it("throws when IMAP list() fails", async () => {
    const svc = new SimpleIMAPService();
    const mockClient = {
      list: vi.fn().mockRejectedValue(new Error("IMAP list failed")),
    };
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    (svc as any).client = mockClient;

    await expect(svc.getFolders()).rejects.toThrow("IMAP list failed");
  });

  it("uses 0 when status.messages and status.unseen are missing (lines 526-527)", async () => {
    const svc = new SimpleIMAPService();
    const mockClient = {
      list: vi.fn().mockResolvedValue([
        { path: "INBOX", name: "INBOX", delimiter: "/", flags: new Set(), specialUse: undefined },
      ]),
      status: vi.fn().mockResolvedValue({}), // no messages/unseen keys → fallback to 0
    };
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    (svc as any).client = mockClient;

    const folders = await svc.getFolders();
    expect(folders[0].totalMessages).toBe(0);
    expect(folders[0].unreadMessages).toBe(0);
  });
});

// ─── estimateCacheBytes (private static) ──────────────────────────────────────

describe("SimpleIMAPService.estimateCacheBytes null fallbacks (lines 96-98)", () => {
  it("falls back to 0 when body/subject/from are undefined", () => {
    const email: EmailMessage = {
      id: "x",
      folder: "INBOX",
      from: undefined as any,   // triggers ?? 0 at line 98
      to: [],
      subject: undefined as any, // triggers ?? 0 at line 97
      body: undefined as any,    // triggers ?? 0 at line 96
      date: new Date(),
      isRead: false,
      isStarred: false,
      hasAttachment: false,
      isHtml: false,
    };

    // estimateCacheBytes is a private static method — call it via setCacheEntry
    const svc = new SimpleIMAPService();
    // Setting a cache entry exercises estimateCacheBytes internally
    (svc as any).setCacheEntry("x", email);
    expect((svc as any).emailCache.has("x")).toBe(true);
    // Byte estimate should be 200 (fixed overhead) when all string fields are undefined
    expect((svc as any).cacheByteEstimate).toBe(200);
  });
});

// ─── getEmailById (early-exit paths) ─────────────────────────────────────────

describe("SimpleIMAPService.getEmailById (early-exit)", () => {
  it("returns cached email when cache hit", async () => {
    const svc = new SimpleIMAPService();
    const email = makeEmail("200");
    (svc as any).setCacheEntry("200", email);

    const result = await svc.getEmailById("200");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("200");
  });

  it("returns null when not connected and cache is empty", async () => {
    const svc = new SimpleIMAPService();
    // isConnected=false, client=null by default

    const result = await svc.getEmailById("404");

    expect(result).toBeNull();
  });
});

// ─── getEmails (early-exit paths and main fetch) ─────────────────────────────

/** Create an async generator that yields the given messages one by one. */
async function* asyncMessages(msgs: unknown[]) {
  for (const m of msgs) yield m;
}

describe("SimpleIMAPService.getEmails", () => {
  it("returns [] when ensureConnection throws", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockRejectedValue(new Error("no config"));

    expect(await svc.getEmails("INBOX")).toEqual([]);
  });

  it("returns [] when client is null after ensureConnection", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    (svc as any).client = null;

    expect(await svc.getEmails("INBOX")).toEqual([]);
  });

  it("returns [] when mailbox has 0 messages", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 0 },
    };

    expect(await svc.getEmails("INBOX")).toEqual([]);
  });

  it("fetches and returns emails from the IMAP fetch loop", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsg = {
      uid: 101,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "Hello World",
        from: [{ name: "Alice", address: "alice@example.com" }],
        to: [{ address: "bob@example.com" }],
        cc: [{ name: "Charlie", address: "charlie@example.com" }], // CC with name
      },
      flags: new Set(["\\Seen"]),
      bodyParts: new Map([["1", Buffer.from("Email body text")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX", 50, 0);

    expect(emails).toHaveLength(1);
    expect(emails[0].id).toBe("101");
    expect(emails[0].subject).toBe("Hello World");
    expect(emails[0].from).toBe("Alice <alice@example.com>");
    expect(emails[0].isRead).toBe(true);
    expect(emails[0].isStarred).toBe(false);
  });

  it("skips messages with no envelope", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsgNoEnv = { uid: 1, envelope: null, flags: new Set(), bodyParts: new Map(), bodyStructure: {} };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsgNoEnv])),
    };

    const emails = await svc.getEmails("INBOX");

    expect(emails).toHaveLength(0);
  });

  it("throws when fetch() rejects", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});

    // Make fetch() itself throw (not iterate)
    async function* throwingGen() { throw new Error("fetch failed"); }

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(throwingGen()),
    };

    await expect(svc.getEmails("INBOX")).rejects.toThrow("fetch failed");
  });

  it("catches per-message parse errors without failing the whole fetch (line 657)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    // countAttachments throws for this message
    vi.spyOn(svc as any, "countAttachments").mockImplementation(() => {
      throw new Error("bodyStructure parse error");
    });

    const mockMsg = {
      uid: 999,
      envelope: {
        date: new Date(),
        subject: "Error email",
        from: [{ address: "a@b.com" }],
        to: [],
        cc: [],
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from("body")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    // Should NOT throw — per-message error is caught and logged
    const emails = await svc.getEmails("INBOX");
    expect(emails).toEqual([]);
  });

  it("uses ?? 50/0 fallback when limit/offset are null (lines 557-558)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 0 },
    };

    // Passing null bypasses default params and triggers ?? 50 / ?? 0 branches at runtime
    const emails = await (svc as any).getEmails("INBOX", null, null);
    expect(emails).toEqual([]);
  });

  it("uses 0 when mailbox is null (line 583 cond-expr branch 1)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: null, // → cond-expr false branch → total=0
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toEqual([]);
  });

  it("handles from with no name and no address (line 619 address ?? '' branch)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsg = {
      uid: 211,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "No from details",
        from: [{}],          // no name, no address → else branch, address ?? '' = ''
        to: [{ name: "Bob" }], // name, no address → a.address ?? '' = '' (line 623)
        cc: [{}],            // no name, no address → a.address ?? '' = '' (line 626)
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from("body")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].from).toBe(""); // no name, no address → ''
    expect(emails[0].to).toEqual(["Bob <>"]); // name but no address
    expect(emails[0].cc).toEqual([""]); // no name, no address → a.address ?? '' = ''
  });

  it("uses empty bodyPreview when bodyParts has no '1' key (line 43 truncateBody)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsg = {
      uid: 200,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "No Body",
        from: [{ address: "a@b.com" }],
        to: [],
        cc: [],
      },
      flags: new Set(),
      bodyParts: new Map(), // no '1' key → bodyText = '' → truncateBody('') → line 43
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].bodyPreview).toBe(""); // truncateBody('') returns ''
  });

  it("truncates long body with word boundary after 80% of limit (lines 53,56,57)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    // Body: 245 'a's then a space then 100 'b's → lastSpace at 245 > 240 (80% of 300) → word-boundary truncation
    const longBody = "a".repeat(245) + " " + "b".repeat(100);

    const mockMsg = {
      uid: 201,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "Long Body",
        from: [{ address: "a@b.com" }],
        to: [],
        cc: [],
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from(longBody)]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].bodyPreview).toMatch(/\.\.\.$/); // ends with ellipsis
    expect(emails[0].bodyPreview!.length).toBeLessThan(longBody.length);
  });

  it("formats addresses with name (to) and without name (cc) — branch coverage (lines 618-626)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsg = {
      uid: 210,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "Address Test",
        from: [{ name: "Alice" }],          // name but no address → address ?? '' = ''
        to: [{ name: "Bob", address: "bob@example.com" }], // with name → covers cond-expr branch 0
        cc: [{ address: "carol@example.com" }],  // no name → covers cond-expr branch 1 for cc
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from("body")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].from).toBe("Alice <>"); // name with empty address fallback
    expect(emails[0].to).toEqual(["Bob <bob@example.com>"]); // with name
    expect(emails[0].cc).toEqual(["carol@example.com"]); // no name
  });

  it("handles null/undefined envelope fields with fallback values (lines 616,639,643,645)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    const mockMsg = {
      uid: 203,
      envelope: {
        date: null,    // → fallback new Date()
        subject: null, // → '(No Subject)'
        from: null,    // → from = ''
        to: null,      // → to = []
        cc: null,      // → cc = []
      },
      flags: undefined, // → isRead=false, isStarred=false
      bodyParts: new Map([["1", Buffer.from("body")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("(No Subject)");
    expect(emails[0].from).toBe("");
    expect(emails[0].to).toEqual([]);
    expect(emails[0].isRead).toBe(false);
  });

  it("calls extractAttachmentMeta when countAttachments > 0 (line 630 branch 0)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(2); // > 0 → extractAttachmentMeta called
    vi.spyOn(svc as any, "extractAttachmentMeta").mockReturnValue([
      { filename: "doc.pdf", contentType: "application/pdf", size: 1024, contentId: undefined },
    ]);

    const mockMsg = {
      uid: 204,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "Has Attachments",
        from: [{ address: "a@b.com" }],
        to: [],
        cc: [],
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from("body")]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].hasAttachment).toBe(true);
    expect(emails[0].attachments).toHaveLength(1);
  });

  it("truncates long body at hard limit when no word boundary after 80% (line 60)", async () => {
    const svc = new SimpleIMAPService();
    vi.spyOn(svc as any, "validateFolderName").mockImplementation(() => {});
    vi.spyOn(svc as any, "ensureConnection").mockResolvedValue(undefined);
    vi.spyOn(svc as any, "checkAndUpdateUidValidity").mockImplementation(() => {});
    vi.spyOn(svc as any, "countAttachments").mockReturnValue(0);

    // 'a '.repeat(120) = 240 chars, last space at 239 (≤ 240 = 80% of 300), then 100 'b's
    // → falls through to hard truncation at line 60
    const longBody = "a ".repeat(120) + "b".repeat(100);

    const mockMsg = {
      uid: 202,
      envelope: {
        date: new Date("2024-01-01"),
        subject: "Hard Truncation",
        from: [{ address: "a@b.com" }],
        to: [],
        cc: [],
      },
      flags: new Set(),
      bodyParts: new Map([["1", Buffer.from(longBody)]]),
      bodyStructure: {},
    };

    (svc as any).client = {
      getMailboxLock: vi.fn().mockResolvedValue(makeLock()),
      mailbox: { exists: 1 },
      fetch: vi.fn().mockReturnValue(asyncMessages([mockMsg])),
    };

    const emails = await svc.getEmails("INBOX");
    expect(emails).toHaveLength(1);
    expect(emails[0].bodyPreview).toMatch(/\.\.\.$/);
  });
});

// ─── getCacheEntry TTL eviction ───────────────────────────────────────────────

describe("SimpleIMAPService getCacheEntry TTL (lines 216-217)", () => {
  it("evicts and returns undefined when cached email TTL has expired", async () => {
    const svc = new SimpleIMAPService();

    const email = makeEmail("77");
    // Manually insert with an expired timestamp (10 min ago, well past 5-min TTL)
    (svc as any).emailCache.set("77", { email, cachedAt: Date.now() - 10 * 60 * 1000 });
    (svc as any).cacheByteEstimate = 100;

    // getEmailById calls getCacheEntry internally; with an expired entry and
    // isConnected=false it should return null (cache miss after TTL eviction)
    const result = await svc.getEmailById("77");
    expect(result).toBeNull();
    // Cache entry should have been evicted
    expect((svc as any).emailCache.has("77")).toBe(false);
  });
});

// ─── disconnect ───────────────────────────────────────────────────────────────

describe("SimpleIMAPService.disconnect", () => {
  it("logs out and clears state when connected", async () => {
    const svc = new SimpleIMAPService();
    const logout = vi.fn().mockResolvedValue(undefined);
    (svc as any).isConnected = true;
    (svc as any).client = { logout };

    await svc.disconnect();

    expect(logout).toHaveBeenCalledTimes(1);
    expect((svc as any).client).toBeNull();
    expect((svc as any).isConnected).toBe(false);
  });

  it("is a no-op when already disconnected", async () => {
    const svc = new SimpleIMAPService();
    // client is null and isConnected is false by default
    await expect(svc.disconnect()).resolves.toBeUndefined();
    expect((svc as any).client).toBeNull();
  });
});

// ─── isActive ─────────────────────────────────────────────────────────────────

describe("SimpleIMAPService.isActive", () => {
  it("returns false when not connected", () => {
    const svc = new SimpleIMAPService();
    expect(svc.isActive()).toBe(false);
  });

  it("returns false when isConnected=true but client=null", () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;
    (svc as any).client = null;
    expect(svc.isActive()).toBe(false);
  });

  it("returns true when connected with a real client", () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;
    (svc as any).client = { noop: vi.fn() };
    expect(svc.isActive()).toBe(true);
  });
});

// ─── reconnect (private) ──────────────────────────────────────────────────────

describe("SimpleIMAPService private reconnect", () => {
  it("throws when connectionConfig is null", async () => {
    const svc = new SimpleIMAPService();
    // connectionConfig is null by default
    await expect((svc as any).reconnect()).rejects.toThrow(/no connection config/);
  });

  it("calls connect() with stored credentials", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).connectionConfig = {
      host: "localhost",
      port: 1143,
      username: "user@example.com",
      password: "secret",
    };
    const connectSpy = vi.spyOn(svc, "connect").mockResolvedValue(undefined);

    await (svc as any).reconnect();

    expect(connectSpy).toHaveBeenCalledWith("localhost", 1143, "user@example.com", "secret", undefined, undefined);
  });
});

// ─── ensureConnection (private) ───────────────────────────────────────────────

describe("SimpleIMAPService private ensureConnection", () => {
  it("does nothing when already connected", async () => {
    const svc = new SimpleIMAPService();
    (svc as any).isConnected = true;
    (svc as any).client = { noop: vi.fn() };
    const reconnectSpy = vi.spyOn(svc as any, "reconnect").mockResolvedValue(undefined);

    await (svc as any).ensureConnection();

    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it("calls reconnect() when not connected", async () => {
    const svc = new SimpleIMAPService();
    // isConnected = false by default
    const reconnectSpy = vi.spyOn(svc as any, "reconnect").mockResolvedValue(undefined);

    await (svc as any).ensureConnection();

    expect(reconnectSpy).toHaveBeenCalledTimes(1);
  });
});
