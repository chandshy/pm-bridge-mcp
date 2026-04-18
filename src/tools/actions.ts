/**
 * Email action tools: mark_email_read, star_email, move_email,
 * archive_email, move_to_trash, move_to_spam, move_to_folder,
 * bulk_mark_read, bulk_star, bulk_move_emails, move_to_label,
 * bulk_move_to_label, remove_label, bulk_remove_label.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  requireNumericEmailId,
  validateFolderName,
  validateLabelName,
  validateTargetFolder,
} from "../utils/helpers.js";
import type { ToolDef, ToolHandler, ToolModule } from "./types.js";

const ACTION_RESULT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    messageId: { type: "string" },
    reason: { type: "string" },
  },
  required: ["success"],
};

const BULK_RESULT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "number" },
    failed: { type: "number" },
    errors: { type: "array", items: { type: "string" } },
  },
  required: ["success", "failed", "errors"],
};

export const defs: ToolDef[] = [
  {
    name: "mark_email_read",
    title: "Mark Email Read/Unread",
    description: "Set the read/unread status of an email. isRead defaults to true.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        isRead: { type: "boolean", default: true },
      },
      required: ["emailId"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "star_email",
    title: "Star / Unstar Email",
    description: "Toggle the starred (flagged) status of an email. isStarred defaults to true.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        isStarred: { type: "boolean", default: true },
      },
      required: ["emailId"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "move_email",
    title: "Move Email",
    description:
      "Move an email to a different folder. Common targets: Trash, Archive, Spam, INBOX, Folders/MyFolder.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        targetFolder: {
          type: "string",
          description: "Destination folder path (e.g. Trash, Archive, Folders/Work)",
        },
      },
      required: ["emailId", "targetFolder"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "archive_email",
    title: "Archive Email",
    description:
      "Move an email to the Archive folder. Convenience wrapper for move_email targeting Archive. Note: labels are lost when an email is moved — label copies in Labels/ folders are not preserved.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: { emailId: { type: "string" } },
      required: ["emailId"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "move_to_trash",
    title: "Move Email to Trash",
    description:
      "Move an email to the Trash folder. Convenience wrapper for move_email targeting Trash. Note: labels are lost when an email is moved — label copies in Labels/ folders are not preserved. Destructive: requires { confirmed: true }.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        confirmed: { type: "boolean", description: "Must be true to execute. See requireDestructiveConfirm." },
      },
      required: ["emailId"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "move_to_spam",
    title: "Move Email to Spam",
    description:
      "Move an email to the Spam folder. Convenience wrapper for move_email targeting Spam. Destructive: requires { confirmed: true }.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        confirmed: { type: "boolean", description: "Must be true to execute. See requireDestructiveConfirm." },
      },
      required: ["emailId"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "move_to_folder",
    title: "Move Email to Custom Folder",
    description:
      "Move an email to a custom folder (Folders/<name>). Similar to move_to_label but for Folders/ paths.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        folder: {
          type: "string",
          description: "Folder name without prefix (e.g. Work). Moves to Folders/Work.",
        },
      },
      required: ["emailId", "folder"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "bulk_mark_read",
    title: "Bulk Mark Emails Read/Unread",
    description:
      "Mark multiple emails as read or unread. Emits progress notifications. Returns success/failed counts.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" }, description: "Array of email UIDs" },
        isRead: { type: "boolean", default: true },
      },
      required: ["emailIds"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
  {
    name: "bulk_star",
    title: "Bulk Star/Unstar Emails",
    description:
      "Star or unstar multiple emails. Emits progress notifications. Returns success/failed counts.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" }, description: "Array of email UIDs" },
        isStarred: { type: "boolean", default: true },
      },
      required: ["emailIds"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
  {
    name: "bulk_move_emails",
    title: "Bulk Move Emails",
    description:
      "Move multiple emails to a folder in one call. Emits progress notifications if a progressToken is provided in _meta. Returns success/failed counts.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of email UIDs to move",
        },
        targetFolder: { type: "string", description: "Destination folder path" },
      },
      required: ["emailIds", "targetFolder"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
  {
    name: "move_to_label",
    title: "Move Email to Label",
    description:
      "Apply a label to an email. The email remains in its original folder and also appears in Labels/{label}. Labels are additive — an email can have multiple labels simultaneously.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        label: {
          type: "string",
          description: "Label name without prefix (e.g. Work). Moves to Labels/Work.",
        },
      },
      required: ["emailId", "label"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "bulk_move_to_label",
    title: "Bulk Move Emails to Label",
    description:
      "Apply a label to multiple emails. Each email remains in its original folder and also appears in Labels/{label}. Progress notifications are sent for large batches.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" } },
        label: { type: "string", description: "Label name without prefix" },
      },
      required: ["emailIds", "label"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
  {
    name: "remove_label",
    title: "Remove Label from Email",
    description:
      "Remove a label from an email. The email is removed from Labels/{label} but remains in its original folder (Inbox, etc.).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string" },
        label: { type: "string", description: "Label name to remove (e.g. Work)" },
        targetFolder: { type: "string", default: "INBOX", description: "Where to move the email (default: INBOX)" },
      },
      required: ["emailId", "label"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "bulk_remove_label",
    title: "Bulk Remove Label from Emails",
    description:
      "Remove a label from multiple emails. Emails are removed from Labels/{label} but remain in their original folders.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" } },
        label: { type: "string", description: "Label name to remove" },
        targetFolder: { type: "string", default: "INBOX", description: "Where to move emails (default: INBOX)" },
      },
      required: ["emailIds", "label"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
];

export const handlers: Record<string, ToolHandler> = {
  mark_email_read: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const merEmailId = requireNumericEmailId(args.emailId);
    if (args.isRead !== undefined && typeof args.isRead !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isRead' must be a boolean when provided.");
    }
    const isRead = args.isRead !== undefined ? (args.isRead as boolean) : true;
    await imapService.markEmailRead(merEmailId, isRead);
    return actionOk();
  },

  star_email: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const seEmailId = requireNumericEmailId(args.emailId);
    if (args.isStarred !== undefined && typeof args.isStarred !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isStarred' must be a boolean when provided.");
    }
    const isStarred = args.isStarred !== undefined ? (args.isStarred as boolean) : true;
    await imapService.starEmail(seEmailId, isStarred);
    return actionOk();
  },

  move_email: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const mvEmailId = requireNumericEmailId(args.emailId);
    const mvValidErr = validateTargetFolder(args.targetFolder);
    if (mvValidErr) throw new McpError(ErrorCode.InvalidParams, mvValidErr);
    await imapService.moveEmail(mvEmailId, args.targetFolder as string);
    return actionOk();
  },

  archive_email: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const aeEmailId = requireNumericEmailId(args.emailId);
    await imapService.moveEmail(aeEmailId, "Archive");
    return actionOk();
  },

  move_to_trash: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const mttEmailId = requireNumericEmailId(args.emailId);
    await imapService.moveEmail(mttEmailId, "Trash");
    return actionOk();
  },

  move_to_spam: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const mtsEmailId = requireNumericEmailId(args.emailId);
    await imapService.moveEmail(mtsEmailId, "Spam");
    return actionOk();
  },

  move_to_folder: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const mtfEmailId = requireNumericEmailId(args.emailId);
    const folderName = args.folder as string;
    const folderValidErr = validateFolderName(folderName);
    if (folderValidErr) throw new McpError(ErrorCode.InvalidParams, folderValidErr);
    await imapService.moveEmail(mtfEmailId, `Folders/${folderName}`);
    return actionOk();
  },

  bulk_mark_read: async (ctx) => {
    const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage } = ctx;
    if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
    }
    const bmrIds = args.emailIds as unknown[];
    const bmrEmailIds: string[] = bmrIds
      .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
      .slice(0, MAX_BULK_IDS);
    if (args.isRead !== undefined && typeof args.isRead !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isRead' must be a boolean when provided.");
    }
    const bmrIsRead = args.isRead !== undefined ? (args.isRead as boolean) : true;
    const bmrTotal = bmrEmailIds.length;
    const bmrResults = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < bmrEmailIds.length; i++) {
      try {
        await imapService.markEmailRead(bmrEmailIds[i], bmrIsRead);
        bmrResults.success++;
      } catch (e: unknown) {
        bmrResults.failed++;
        bmrResults.errors.push(`${bmrEmailIds[i]}: ${safeErrorMessage(e)}`);
      }
      await sendProgress(i + 1, bmrTotal, `Marked ${i + 1} of ${bmrTotal}`);
    }
    return bulkOk(bmrResults);
  },

  bulk_star: async (ctx) => {
    const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage } = ctx;
    if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
    }
    const bsIds = args.emailIds as unknown[];
    const bsEmailIds: string[] = bsIds
      .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
      .slice(0, MAX_BULK_IDS);
    if (args.isStarred !== undefined && typeof args.isStarred !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isStarred' must be a boolean when provided.");
    }
    const bsIsStarred = args.isStarred !== undefined ? (args.isStarred as boolean) : true;
    const bsTotal = bsEmailIds.length;
    const bsResults = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < bsEmailIds.length; i++) {
      try {
        await imapService.starEmail(bsEmailIds[i], bsIsStarred);
        bsResults.success++;
      } catch (e: unknown) {
        bsResults.failed++;
        bsResults.errors.push(`${bsEmailIds[i]}: ${safeErrorMessage(e)}`);
      }
      await sendProgress(i + 1, bsTotal, `Starred ${i + 1} of ${bsTotal}`);
    }
    return bulkOk(bsResults);
  },

  bulk_move_emails: async (ctx) => {
    const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage, state } = ctx;
    const bmValidErr = validateTargetFolder(args.targetFolder);
    if (bmValidErr) throw new McpError(ErrorCode.InvalidParams, bmValidErr);
    if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
    }
    const rawIds = args.emailIds as unknown[];
    const emailIds: string[] = rawIds
      .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
      .slice(0, MAX_BULK_IDS);
    const targetFolder = args.targetFolder as string;
    const total = emailIds.length;
    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < emailIds.length; i++) {
      try {
        await imapService.moveEmail(emailIds[i], targetFolder);
        results.success++;
      } catch (e: unknown) {
        results.failed++;
        results.errors.push(`${emailIds[i]}: ${safeErrorMessage(e)}`);
      }
      await sendProgress(i + 1, total, `Moved ${i + 1} of ${total}`);
    }

    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return bulkOk(results);
  },

  move_to_label: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const mtlEmailId = requireNumericEmailId(args.emailId);
    if (!args.label || typeof args.label !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'label' is required and must be a string.");
    }
    const label = args.label as string;
    const mtlValidErr = validateLabelName(label);
    if (mtlValidErr) throw new McpError(ErrorCode.InvalidParams, mtlValidErr);
    await imapService.copyEmailToFolder(mtlEmailId, `Labels/${label}`);
    return actionOk();
  },

  bulk_move_to_label: async (ctx) => {
    const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage, state } = ctx;
    if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
    }
    const rawIds2 = args.emailIds as unknown[];
    const emailIds2: string[] = rawIds2
      .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
      .slice(0, MAX_BULK_IDS);
    if (!args.label || typeof args.label !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'label' is required and must be a string.");
    }
    const rawLabel = args.label as string;
    const bmlValidErr = validateLabelName(rawLabel);
    if (bmlValidErr) throw new McpError(ErrorCode.InvalidParams, bmlValidErr);
    const labelFolder = `Labels/${rawLabel}`;
    const total2 = emailIds2.length;
    const results2 = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < emailIds2.length; i++) {
      try {
        await imapService.copyEmailToFolder(emailIds2[i], labelFolder);
        results2.success++;
      } catch (e: unknown) {
        results2.failed++;
        results2.errors.push(`${emailIds2[i]}: ${safeErrorMessage(e)}`);
      }
      await sendProgress(i + 1, total2, `Labeled ${i + 1} of ${total2}`);
    }

    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return bulkOk(results2);
  },

  remove_label: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const rlEmailId = requireNumericEmailId(args.emailId);
    if (!args.label || typeof args.label !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'label' is required and must be a string.");
    }
    const rlLabel = args.label as string;
    const rlLabelValidErr = validateLabelName(rlLabel);
    if (rlLabelValidErr) throw new McpError(ErrorCode.InvalidParams, rlLabelValidErr);
    await imapService.deleteFromFolder(rlEmailId, `Labels/${rlLabel}`);
    return actionOk();
  },

  bulk_remove_label: async (ctx) => {
    const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage, state } = ctx;
    if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
      throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
    }
    const brlIds = args.emailIds as unknown[];
    const brlEmailIds: string[] = brlIds
      .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
      .slice(0, MAX_BULK_IDS);
    if (!args.label || typeof args.label !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'label' is required and must be a string.");
    }
    const brlLabel = args.label as string;
    const brlLabelValidErr = validateLabelName(brlLabel);
    if (brlLabelValidErr) throw new McpError(ErrorCode.InvalidParams, brlLabelValidErr);
    const brlLabelFolder = `Labels/${brlLabel}`;
    const brlTotal = brlEmailIds.length;
    const brlResults = { success: 0, failed: 0, errors: [] as string[] };

    for (let i = 0; i < brlEmailIds.length; i++) {
      try {
        await imapService.deleteFromFolder(brlEmailIds[i], brlLabelFolder);
        brlResults.success++;
      } catch (e: unknown) {
        brlResults.failed++;
        brlResults.errors.push(`${brlEmailIds[i]}: ${safeErrorMessage(e)}`);
      }
      await sendProgress(i + 1, brlTotal, `Unlabeled ${i + 1} of ${brlTotal}`);
    }

    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return bulkOk(brlResults);
  },
};

const mod: ToolModule = { defs, handlers };
export default mod;
