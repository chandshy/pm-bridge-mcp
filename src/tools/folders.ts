/**
 * Folder management tools: get_folders, sync_folders, create_folder,
 * delete_folder, rename_folder.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateTargetFolder } from "../utils/helpers.js";
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

export const defs: ToolDef[] = [
  {
    name: "get_folders",
    title: "Get Folders",
    description:
      "List all email folders with message counts. Labels appear as folders with the Labels/ prefix (e.g. Labels/Work).",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        folders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              path: { type: "string" },
              totalMessages: { type: "number" },
              unreadMessages: { type: "number" },
            },
          },
        },
      },
      required: ["folders"],
    },
  },
  {
    name: "sync_folders",
    title: "Sync Folders",
    description: "Refresh the folder list from IMAP (invalidates folder cache). Call this after creating/renaming/deleting folders in another client or if folder counts seem stale.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { success: { type: "boolean" }, folderCount: { type: "number" } },
      required: ["success", "folderCount"],
    },
  },
  {
    name: "create_folder",
    title: "Create Folder",
    description:
      "Create a new email folder or label. Use Folders/Name for custom folders, Labels/Name for labels. Must exist before using move_to_label.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        folderName: {
          type: "string",
          description: "Folder path to create (e.g. Folders/Archive, Labels/Work)",
        },
      },
      required: ["folderName"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "delete_folder",
    title: "Delete Folder",
    description:
      "Delete an empty folder or label. Protected system folders (INBOX, Sent, Drafts, Trash, Spam, Archive, All Mail, Starred) cannot be deleted.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        folderName: { type: "string", description: "Folder path to delete" },
      },
      required: ["folderName"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "rename_folder",
    title: "Rename Folder",
    description: "Rename a custom folder or label. Protected system folders cannot be renamed.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        oldName: { type: "string", description: "Current folder path" },
        newName: { type: "string", description: "New folder path" },
      },
      required: ["oldName", "newName"],
    },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_folders: async (ctx) => {
    const { imapService, ok } = ctx;
    const folders = await imapService.getFolders();
    return ok({ folders });
  },

  sync_folders: async (ctx) => {
    const { imapService, ok } = ctx;
    const folders = await imapService.getFolders();
    return ok({ success: true, folderCount: folders.length });
  },

  create_folder: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const cfValidErr = validateTargetFolder(args.folderName);
    if (cfValidErr) throw new McpError(ErrorCode.InvalidParams, cfValidErr);
    if (!args.folderName || typeof args.folderName !== "string" || !(args.folderName as string).trim()) {
      throw new McpError(ErrorCode.InvalidParams, "folderName must be a non-empty string.");
    }
    await imapService.createFolder(args.folderName as string);
    return actionOk();
  },

  delete_folder: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const dfValidErr = validateTargetFolder(args.folderName);
    if (dfValidErr) throw new McpError(ErrorCode.InvalidParams, dfValidErr);
    if (!args.folderName || typeof args.folderName !== "string" || !(args.folderName as string).trim()) {
      throw new McpError(ErrorCode.InvalidParams, "folderName must be a non-empty string.");
    }
    await imapService.deleteFolder(args.folderName as string);
    return actionOk();
  },

  rename_folder: async (ctx) => {
    const { args, imapService, actionOk } = ctx;
    const rfOldErr = validateTargetFolder(args.oldName);
    if (rfOldErr) throw new McpError(ErrorCode.InvalidParams, `oldName: ${rfOldErr}`);
    if (!args.oldName || typeof args.oldName !== "string" || !(args.oldName as string).trim()) {
      throw new McpError(ErrorCode.InvalidParams, "oldName must be a non-empty string.");
    }
    const rfNewErr = validateTargetFolder(args.newName);
    if (rfNewErr) throw new McpError(ErrorCode.InvalidParams, `newName: ${rfNewErr}`);
    if (!args.newName || typeof args.newName !== "string" || !(args.newName as string).trim()) {
      throw new McpError(ErrorCode.InvalidParams, "newName must be a non-empty string.");
    }
    if ((args.oldName as string) === (args.newName as string)) {
      throw new McpError(ErrorCode.InvalidParams, "'newName' must be different from 'oldName'.");
    }
    await imapService.renameFolder(args.oldName as string, args.newName as string);
    return actionOk();
  },
};

const mod: ToolModule = { defs, handlers };
export default mod;
