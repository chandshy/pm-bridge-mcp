/**
 * Deletion tools: delete_email, bulk_delete_emails, bulk_delete.
 *
 * Both bulk_delete and bulk_delete_emails share the same handler — the
 * pre-refactor switch fall-through is preserved by registering one handler
 * function under both names.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { requireNumericEmailId } from "../utils/helpers.js";
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
    name: "delete_email",
    title: "Delete Email",
    description:
      "Permanently delete an email. This action cannot be undone. Consider move_email to Trash first. Destructive: requires { confirmed: true }.",
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
    name: "bulk_delete_emails",
    title: "Bulk Delete Emails",
    description:
      "Permanently delete multiple emails. Irreversible. Emits progress notifications if a progressToken is provided in _meta. Returns success/failed counts. Destructive: requires { confirmed: true }.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" } },
        confirmed: { type: "boolean", description: "Must be true to execute. See requireDestructiveConfirm." },
      },
      required: ["emailIds"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
  {
    name: "bulk_delete",
    title: "Bulk Delete Emails",
    description:
      "Alias for bulk_delete_emails. Permanently delete multiple emails. Irreversible. Destructive: requires { confirmed: true }.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        emailIds: { type: "array", items: { type: "string" } },
        confirmed: { type: "boolean", description: "Must be true to execute. See requireDestructiveConfirm." },
      },
      required: ["emailIds"],
    },
    outputSchema: BULK_RESULT_SCHEMA,
  },
];

const bulkDeleteHandler: ToolHandler = async (ctx) => {
  const { args, imapService, bulkOk, sendProgress, MAX_BULK_IDS, safeErrorMessage, state } = ctx;
  if (!Array.isArray(args.emailIds) || (args.emailIds as unknown[]).length === 0) {
    throw new McpError(ErrorCode.InvalidParams, "emailIds must be a non-empty array of numeric UID strings.");
  }
  const rawIds3 = args.emailIds as unknown[];
  const emailIds3: string[] = rawIds3
    .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id))
    .slice(0, MAX_BULK_IDS);
  const total3 = emailIds3.length;
  const results3 = { success: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < emailIds3.length; i++) {
    try {
      await imapService.deleteEmail(emailIds3[i]);
      results3.success++;
    } catch (e: unknown) {
      results3.failed++;
      results3.errors.push(`${emailIds3[i]}: ${safeErrorMessage(e)}`);
    }
    await sendProgress(i + 1, total3, `Deleted ${i + 1} of ${total3}`);
  }

  state.analyticsCache = null;
  state.analyticsCacheInflight = null;
  return bulkOk(results3);
};

export const handlers: Record<string, ToolHandler> = {
  delete_email: async (ctx) => {
    const { args, imapService, actionOk, state } = ctx;
    const deEmailId = requireNumericEmailId(args.emailId);
    await imapService.deleteEmail(deEmailId);
    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return actionOk();
  },

  bulk_delete: bulkDeleteHandler,
  bulk_delete_emails: bulkDeleteHandler,
};

const mod: ToolModule = { defs, handlers };
export default mod;
