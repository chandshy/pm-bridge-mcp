/**
 * Reading tools.
 *
 * The ListTools order in the pre-refactor index.ts interleaves reading
 * definitions with other categories:
 *   - The "early" reading group (get_emails … get_emails_by_label) appears
 *     immediately after Sending, before Folders / Actions / Deletion /
 *     Analytics / System / Bridge / Aliases / Pass / Drafts.
 *   - The "late" reading group (download_attachment … extract_meeting)
 *     appears after Drafts and before Escalation.
 *
 * Preserving the historical ordering is load-bearing — ListTools output
 * ordering affects client-side system prompts. The registry splices these
 * two arrays in at the correct positions. `defs` below is the concatenated
 * full list; `defsEarly` / `defsLate` expose the split for the registry.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  isValidEmail,
  requireNumericEmailId,
  validateLabelName,
  validateTargetFolder,
} from "../utils/helpers.js";
import { extractActionItems, parseIcs } from "../services/content-parser.js";
import { FtsUnavailableError } from "../services/fts-service.js";
import type { FtsIndexService } from "../services/fts-service.js";
import type { EmailMessage, EmailFolder } from "../types/index.js";
import { logger } from "../utils/logger.js";
import type { ToolDef, ToolHandler, ToolModule } from "./types.js";

const EMAIL_SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "IMAP UID for use in follow-up tool calls" },
    from: { type: "string" },
    to: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    bodyPreview: { type: "string", description: "First ~300 chars of body" },
    date: { type: "string", format: "date-time" },
    folder: { type: "string" },
    isRead: { type: "boolean" },
    isStarred: { type: "boolean" },
    hasAttachment: { type: "boolean" },
  },
  required: ["id", "from", "subject", "date", "isRead", "folder"],
};

export const defsEarly: ToolDef[] = [
  {
    name: "get_emails",
    title: "Get Emails",
    description:
      "Fetch a page of emails from a folder. Returns summary fields (id, from, subject, date, isRead, bodyPreview, isAnswered, isForwarded). Use id with get_email_by_id for full content including body and attachments. Pass nextCursor from a previous response to get the next page.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Folder path. Examples: INBOX, Sent, Trash, Folders/MyFolder",
          default: "INBOX",
        },
        limit: {
          type: "number",
          description: "Emails per page (1-200, default 50)",
          default: 50,
        },
        cursor: {
          type: "string",
          description: "Opaque cursor from previous response nextCursor to get next page. Omit for first page.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        emails: { type: "array", items: EMAIL_SUMMARY_SCHEMA },
        folder: { type: "string" },
        count: { type: "number" },
        nextCursor: {
          type: "string",
          description: "Pass this value as cursor in the next call. Absent when no more pages.",
        },
      },
      required: ["emails", "folder", "count"],
    },
  },
  {
    name: "get_email_by_id",
    title: "Get Email by ID",
    description:
      "Fetch a single email's full content including body, attachment metadata (no binary content), isAnswered, and isForwarded flags. Use the id returned by get_emails or search_emails.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        emailId: { type: "string", description: "IMAP UID from get_emails or search_emails" },
      },
      required: ["emailId"],
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        from: { type: "string" },
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        isHtml: { type: "boolean" },
        date: { type: "string", format: "date-time" },
        folder: { type: "string" },
        isRead: { type: "boolean" },
        isStarred: { type: "boolean" },
        hasAttachment: { type: "boolean" },
        isAnswered: { type: "boolean", description: "True if the email has been replied to (\\Answered IMAP flag)" },
        isForwarded: { type: "boolean", description: "True if the email has been forwarded ($Forwarded IMAP flag)" },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string" },
              contentType: { type: "string" },
              size: { type: "number" },
            },
          },
        },
      },
      required: ["id", "from", "subject", "body", "date", "isRead"],
    },
  },
  {
    name: "search_emails",
    title: "Search Emails",
    description:
      "Search emails by sender, recipient (To/CC/BCC), subject, body content, date range (received or sent), size, read/replied/starred/draft status, or attachment presence. Searches are server-side IMAP SEARCH except hasAttachment which filters locally. Use `folder` for a single folder or `folders` for multiple (pass [\"*\"] to search all). Returns summary fields. Use get_email_by_id for full content.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", default: "INBOX", description: "Single folder to search (ignored if `folders` is set)" },
        folders: {
          type: "array",
          items: { type: "string" },
          description: "Search multiple folders. Use [\"*\"] to search all folders (capped at 20). Overrides `folder`.",
        },
        from: { type: "string", description: "Filter by sender address or name" },
        to: { type: "string", description: "Filter by recipient address" },
        subject: { type: "string", description: "Filter by subject text" },
        hasAttachment: { type: "boolean" },
        isRead: { type: "boolean" },
        isStarred: { type: "boolean" },
        dateFrom: { type: "string", description: "ISO 8601 start date (INTERNALDATE — when received by server)" },
        dateTo: { type: "string", description: "ISO 8601 end date (INTERNALDATE — when received by server)" },
        limit: { type: "number", description: "Max results (1-200, default 50)", default: 50 },
        body: { type: "string", description: "Search within email body content" },
        text: { type: "string", description: "Search headers and body (full text)" },
        bcc: { type: "string", description: "Filter by BCC recipient" },
        answered: { type: "boolean", description: "Filter by whether email has been replied to" },
        isDraft: { type: "boolean", description: "Filter by draft status" },
        larger: { type: "number", description: "Minimum email size in bytes" },
        smaller: { type: "number", description: "Maximum email size in bytes" },
        sentBefore: { type: "string", format: "date-time", description: "Filter by Date: header before this date (ISO 8601)" },
        sentSince: { type: "string", format: "date-time", description: "Filter by Date: header since this date (ISO 8601)" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        emails: { type: "array", items: EMAIL_SUMMARY_SCHEMA },
        count: { type: "number" },
        folder: { type: "string" },
      },
      required: ["emails", "count", "folder"],
    },
  },
  {
    name: "get_unread_count",
    title: "Get Unread Count",
    description:
      "Get unread email count for each folder. Cheap call — use this before get_emails to decide whether to fetch. Returns object mapping folder path to unread count.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        unreadByFolder: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Folder path -> unread count",
        },
        totalUnread: { type: "number" },
      },
      required: ["unreadByFolder", "totalUnread"],
    },
  },
  {
    name: "list_labels",
    title: "List Labels",
    description:
      "List all Proton Mail labels with message counts. Returns only labels (Labels/ prefix), not regular folders.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        labels: {
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
        count: { type: "number" },
      },
      required: ["labels", "count"],
    },
  },
  {
    name: "get_emails_by_label",
    title: "Get Emails by Label",
    description:
      "Fetch emails from a specific label folder. Shortcut for get_emails with folder set to Labels/<label>.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Label name without prefix (e.g. Work)" },
        limit: { type: "number", default: 50, description: "Emails per page, 1-200" },
        cursor: { type: "string", description: "Opaque cursor from previous response" },
      },
      required: ["label"],
    },
    outputSchema: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "object" } },
        count: { type: "number" },
        folder: { type: "string" },
        nextCursor: { type: "string" },
      },
    },
  },
];

export const defsLate: ToolDef[] = [
  {
    name: "download_attachment",
    title: "Download Attachment",
    description:
      "Download the binary content of an email attachment as a base64-encoded string. Use get_email_by_id first to see available attachments and their indices (0-based).",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "IMAP UID of the email" },
        attachment_index: { type: "number", description: "0-based index of the attachment (from get_email_by_id attachments array)" },
      },
      required: ["email_id", "attachment_index"],
    },
    outputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        contentType: { type: "string" },
        size: { type: "number" },
        content: { type: "string", description: "Base64-encoded attachment content" },
        encoding: { type: "string", enum: ["base64"] },
      },
      required: ["filename", "contentType", "size", "content", "encoding"],
    },
  },
  {
    name: "get_thread",
    title: "Get Email Thread",
    description:
      "Return all messages that look like they belong to the same thread as the given email. Uses the normalized Subject (Re:/Fwd: stripped) to collect related messages from INBOX + Sent. Useful for summarising long conversations in one call.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "IMAP UID of any message in the thread" },
        max_messages: { type: "number", description: "Max messages to return (default 50, cap 200)" },
      },
      required: ["email_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Normalized subject line for the thread" },
        messages: {
          type: "array",
          items: EMAIL_SUMMARY_SCHEMA,
          description: "Messages in the thread, oldest-first",
        },
      },
      required: ["subject", "messages"],
    },
  },
  {
    name: "get_correspondence_profile",
    title: "Get Correspondence Profile",
    description:
      "Return relationship statistics for a single email address — volume sent/received, first and last interaction, average response time (if computable). Useful before drafting so the agent can match tone and recall context.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address to look up" },
      },
      required: ["email"],
    },
    outputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        name: { type: "string" },
        emailsSent: { type: "number" },
        emailsReceived: { type: "number" },
        firstInteraction: { type: ["string", "null"], format: "date-time" },
        lastInteraction: { type: ["string", "null"], format: "date-time" },
        averageResponseTime: { type: ["number", "null"], description: "Minutes; null when not computable" },
        isFavorite: { type: "boolean" },
      },
      required: ["email", "emailsSent", "emailsReceived"],
    },
  },
  {
    name: "fts_search",
    title: "Full-Text Search (Local Index)",
    description:
      "BM25-ranked keyword search over the locally-indexed mail corpus. Supports FTS5 syntax: phrases (\"exact phrase\"), boolean (foo AND bar, foo OR bar, NOT baz), prefix (proto*), and column filters (subject:invoice from:alice). Faster and smarter than search_emails, but requires the local index to be built — call fts_rebuild if fts_status shows it empty.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "FTS5 query string" },
        folder: { type: "string", description: "Restrict results to a single folder" },
        sinceEpoch: { type: "number", description: "Filter to messages whose date is at or after this Unix-epoch second" },
        limit: { type: "number", description: "Max hits to return (1–200, default 20)" },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: {
        hits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              subject: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
              folder: { type: "string" },
              snippet: { type: "string" },
              dateEpoch: { type: "number" },
              score: { type: "number" },
            },
          },
        },
      },
      required: ["hits"],
    },
  },
  {
    name: "fts_rebuild",
    title: "Rebuild Local FTS Index",
    description:
      "Clear the local FTS5 index and rebuild it from the messages currently cached by the analytics layer (INBOX + Sent). Intended for use after major mailbox changes or when fts_search returns stale results. Returns the number of messages indexed.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        indexed: { type: "number" },
        messageCount: { type: "number" },
        dbPath: { type: "string" },
      },
    },
  },
  {
    name: "fts_status",
    title: "FTS Index Status",
    description: "Report the path, row count, and on-disk size of the local FTS5 index. Returns { available: false } when better-sqlite3 is not installed.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        available: { type: "boolean" },
        messageCount: { type: "number" },
        dbPath: { type: "string" },
        databaseBytes: { type: "number" },
        reason: { type: "string" },
      },
    },
  },
  {
    name: "extract_action_items",
    title: "Extract Action Items",
    description:
      "Scan a single email's body for action-item-looking lines (bullets with action verbs, TODO:/ACTION: markers, @mentions) and return a structured list with best-effort assignee and due-date fields. Heuristic — not a replacement for a real task extractor, but useful for quick triage.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "IMAP UID from get_emails / search_emails" },
      },
      required: ["email_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        action_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              assignee: { type: "string" },
              due: { type: "string" },
            },
            required: ["text"],
          },
        },
      },
      required: ["action_items"],
    },
  },
  {
    name: "extract_meeting",
    title: "Extract Meeting from ICS",
    description:
      "Parse an iCalendar (ICS) attachment or inline VCALENDAR block out of an email and return structured meeting details. Returns { meeting: null } when no ICS block is found. Supports RFC 5545 line folding and the common VEVENT properties (SUMMARY, DTSTART, DTEND, LOCATION, ORGANIZER, ATTENDEE, DESCRIPTION, RRULE).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "IMAP UID from get_emails / search_emails" },
      },
      required: ["email_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        meeting: {
          type: ["object", "null"],
          properties: {
            summary: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            location: { type: "string" },
            organizer: { type: "string" },
            attendees: { type: "array", items: { type: "string" } },
            description: { type: "string" },
            rrule: { type: "string" },
          },
          required: ["summary", "start"],
        },
      },
    },
  },
];

export const defs: ToolDef[] = [...defsEarly, ...defsLate];

export const handlers: Record<string, ToolHandler> = {
  get_emails: async (ctx) => {
    const { args, imapService, ok, limits, encodeCursor, decodeCursor } = ctx;
    const folder = (args.folder as string) || "INBOX";
    const geValidErr = validateTargetFolder(folder);
    if (geValidErr) throw new McpError(ErrorCode.InvalidParams, geValidErr);
    if (args.limit !== undefined && typeof args.limit !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be a number.");
    }
    const limit = Math.min(Math.max(1, (args.limit as number) || 50), 200, limits.maxEmailListResults);

    if (args.cursor !== undefined && typeof args.cursor !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'cursor' must be a string.");
    }
    let offset = 0;
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor as string);
      if (!decoded || decoded.folder !== folder) {
        return { content: [{ type: "text" as const, text: "Invalid or expired cursor" }], isError: true, structuredContent: { success: false, reason: "Invalid cursor" } };
      }
      offset = decoded.offset;
    }

    const emails = await imapService.getEmails(folder, limit, offset);

    let nextCursor: string | undefined;
    if (emails.length === limit) {
      nextCursor = encodeCursor({ folder, offset: offset + limit, limit });
    }

    const structured = { emails, folder, count: emails.length, ...(nextCursor ? { nextCursor } : {}) };
    return ok(structured);
  },

  get_email_by_id: async (ctx) => {
    const { args, imapService, ok, limits } = ctx;
    const rawEmailId = requireNumericEmailId(args.emailId);
    const email = await imapService.getEmailById(rawEmailId);
    if (!email) {
      return { content: [{ type: "text" as const, text: "Email not found" }], isError: true, structuredContent: { success: false, reason: "Resource not found" } };
    }
    if (email.body && email.body.length > limits.maxEmailBodyChars) {
      const originalLen = email.body.length;
      email.body = email.body.substring(0, limits.maxEmailBodyChars)
        + `\n\n[...body truncated at ${limits.maxEmailBodyChars.toLocaleString()} chars — original was ${originalLen.toLocaleString()} chars]`;
    }
    return ok(email as unknown as Record<string, unknown>);
  },

  search_emails: async (ctx) => {
    const { args, imapService, ok, limits } = ctx;
    const folder = (args.folder as string) || "INBOX";
    const folders = args.folders as string[] | undefined;
    if (!folders) {
      const seFolderErr = validateTargetFolder(folder);
      if (seFolderErr) throw new McpError(ErrorCode.InvalidParams, `folder: ${seFolderErr}`);
    }
    if (folders && !(folders.length === 1 && folders[0] === "*")) {
      for (let i = 0; i < folders.length; i++) {
        const fErr = validateTargetFolder(folders[i]);
        if (fErr) throw new McpError(ErrorCode.InvalidParams, `folders[${i}]: ${fErr}`);
      }
    }
    const MAX_SEARCH_TEXT = 500;
    if (args.from !== undefined && typeof args.from !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'from' filter must be a string when provided.");
    }
    if (args.from && (args.from as string).length > MAX_SEARCH_TEXT) {
      throw new McpError(ErrorCode.InvalidParams, `'from' filter must not exceed ${MAX_SEARCH_TEXT} characters.`);
    }
    if (args.to !== undefined && typeof args.to !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'to' filter must be a string when provided.");
    }
    if (args.to && (args.to as string).length > MAX_SEARCH_TEXT) {
      throw new McpError(ErrorCode.InvalidParams, `'to' filter must not exceed ${MAX_SEARCH_TEXT} characters.`);
    }
    if (args.subject !== undefined && typeof args.subject !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'subject' filter must be a string when provided.");
    }
    if (args.subject && (args.subject as string).length > MAX_SEARCH_TEXT) {
      throw new McpError(ErrorCode.InvalidParams, `'subject' filter must not exceed ${MAX_SEARCH_TEXT} characters.`);
    }
    if (args.hasAttachment !== undefined && typeof args.hasAttachment !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'hasAttachment' must be a boolean when provided.");
    }
    if (args.isRead !== undefined && typeof args.isRead !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isRead' must be a boolean when provided.");
    }
    if (args.isStarred !== undefined && typeof args.isStarred !== "boolean") {
      throw new McpError(ErrorCode.InvalidParams, "'isStarred' must be a boolean when provided.");
    }
    if (args.limit !== undefined && typeof args.limit !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be a number.");
    }
    if (args.dateFrom !== undefined && typeof args.dateFrom !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'dateFrom' must be a string when provided.");
    }
    if (args.dateTo !== undefined && typeof args.dateTo !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'dateTo' must be a string when provided.");
    }
    if (args.dateFrom && args.dateTo) {
      const dfTs = Date.parse(args.dateFrom as string);
      const dtTs = Date.parse(args.dateTo as string);
      if (!isNaN(dfTs) && !isNaN(dtTs) && dfTs > dtTs) {
        throw new McpError(ErrorCode.InvalidParams, "'dateFrom' must not be later than 'dateTo'.");
      }
    }
    const body     = typeof args.body === 'string' ? args.body : undefined;
    const text     = typeof args.text === 'string' ? args.text : undefined;
    const bcc      = typeof args.bcc === 'string' ? args.bcc : undefined;
    const answered = typeof args.answered === 'boolean' ? args.answered : undefined;
    const isDraft  = typeof args.isDraft === 'boolean' ? args.isDraft : undefined;
    const larger   = typeof args.larger === 'number' ? args.larger : undefined;
    const smaller  = typeof args.smaller === 'number' ? args.smaller : undefined;
    const sentBefore = args.sentBefore ? new Date(args.sentBefore as string) : undefined;
    const sentSince  = args.sentSince  ? new Date(args.sentSince  as string) : undefined;

    const results = await imapService.searchEmails({
      folder: folders ? undefined : folder,
      folders,
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      subject: args.subject as string | undefined,
      hasAttachment: args.hasAttachment as boolean | undefined,
      isRead: args.isRead as boolean | undefined,
      isStarred: args.isStarred as boolean | undefined,
      dateFrom: args.dateFrom as string | undefined,
      dateTo: args.dateTo as string | undefined,
      limit: Math.min(Math.max(1, (args.limit as number) || 50), 200, limits.maxEmailListResults),
      body,
      text,
      bcc,
      answered,
      isDraft,
      larger,
      smaller,
      sentBefore,
      sentSince,
    });
    const searchedIn = folders ? folders.join(", ") : folder;
    return ok({ emails: results, count: results.length, folder: searchedIn });
  },

  get_unread_count: async (ctx) => {
    const { imapService, ok } = ctx;
    const folders = await imapService.getFolders();
    const unreadByFolder: Record<string, number> = {};
    let totalUnread = 0;
    for (const f of folders) {
      unreadByFolder[f.path] = f.unreadMessages;
      totalUnread += f.unreadMessages;
    }
    return ok({ unreadByFolder, totalUnread });
  },

  list_labels: async (ctx) => {
    const { imapService, ok } = ctx;
    const allFolders = await imapService.getFolders();
    const labels = allFolders.filter((f: EmailFolder) => f.path.startsWith("Labels/"));
    return ok({ labels, count: labels.length });
  },

  get_emails_by_label: async (ctx) => {
    const { args, imapService, ok, limits, encodeCursor, decodeCursor } = ctx;
    if (!args.label || typeof args.label !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'label' is required and must be a string.");
    }
    const lblName = args.label as string;
    const lblValidErr = validateLabelName(lblName);
    if (lblValidErr) throw new McpError(ErrorCode.InvalidParams, lblValidErr);
    const lblFolder = `Labels/${lblName}`;
    if (args.limit !== undefined && typeof args.limit !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be a number.");
    }
    const lblLimit = Math.min(Math.max((args.limit as number) || 50, 1), 200, limits.maxEmailListResults);

    if (args.cursor !== undefined && typeof args.cursor !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'cursor' must be a string.");
    }
    let lblOffset = 0;
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor as string);
      if (!decoded || decoded.folder !== lblFolder) {
        return { content: [{ type: "text" as const, text: "Invalid or expired cursor" }], isError: true, structuredContent: { success: false, reason: "Invalid cursor" } };
      }
      lblOffset = decoded.offset;
    }

    const lblEmails = await imapService.getEmails(lblFolder, lblLimit, lblOffset);
    let lblNextCursor: string | undefined;
    if (lblEmails.length === lblLimit) {
      lblNextCursor = encodeCursor({ folder: lblFolder, offset: lblOffset + lblLimit, limit: lblLimit });
    }

    const lblStructured = { emails: lblEmails, folder: lblFolder, count: lblEmails.length, ...(lblNextCursor ? { nextCursor: lblNextCursor } : {}) };
    return ok(lblStructured);
  },

  download_attachment: async (ctx) => {
    const { args, imapService, ok, limits } = ctx;
    const rawAttEmailId = requireNumericEmailId(args.email_id, "email_id");
    const rawAttIdx = args.attachment_index as number;
    const MAX_ATTACHMENT_INDEX = 50;
    if (!Number.isInteger(rawAttIdx) || rawAttIdx < 0) {
      throw new McpError(ErrorCode.InvalidParams, "attachment_index must be a non-negative integer.");
    }
    if (rawAttIdx > MAX_ATTACHMENT_INDEX) {
      throw new McpError(ErrorCode.InvalidParams, `attachment_index must be at most ${MAX_ATTACHMENT_INDEX}.`);
    }
    const attResult = await imapService.downloadAttachment(rawAttEmailId, rawAttIdx);
    if (!attResult) {
      return { content: [{ type: "text" as const, text: "Attachment not found" }], isError: true, structuredContent: { success: false, reason: "Attachment not found" } };
    }
    const encodedLen = typeof attResult.content === "string" ? attResult.content.length : 0;
    if (encodedLen > limits.maxAttachmentBytes) {
      logger.warn(
        `Attachment "${attResult.filename}" too large: ${encodedLen} bytes encoded (limit ${limits.maxAttachmentBytes})`,
        "ResponseGuard",
      );
      const attError = {
        success: false,
        reason: "Attachment too large to return inline",
        filename: attResult.filename,
        contentType: attResult.contentType,
        sizeBytes: attResult.size,
        encodedSizeBytes: encodedLen,
        limitBytes: limits.maxAttachmentBytes,
      };
      return {
        content: [{ type: "text" as const, text: `Attachment "${attResult.filename}" is too large (${attResult.size} bytes raw, ${encodedLen} bytes encoded). Limit: ${limits.maxAttachmentBytes} bytes. Increase maxAttachmentBytes in Settings → Debug Logs → Response Limits to download larger files.` }],
        structuredContent: attError,
        isError: true,
      };
    }
    return ok(attResult, `Attachment: ${attResult.filename} (${attResult.contentType}, ${attResult.size} bytes)`);
  },

  get_thread: async (ctx) => {
    const { args, imapService, ok } = ctx;
    const threadEmailId = requireNumericEmailId(args.email_id, "email_id");
    const maxMsgs = typeof args.max_messages === "number"
      ? Math.min(Math.max(1, args.max_messages), 200)
      : 50;
    const seed = await imapService.getEmailById(threadEmailId);
    if (!seed) {
      return { content: [{ type: "text" as const, text: "Seed message not found" }], isError: true, structuredContent: { success: false, reason: "Seed message not found" } };
    }
    const normalizeSubject = (s: string) => s.replace(/^(\s*(re|fwd|fw):\s*)+/i, "").trim();
    const normalized = normalizeSubject(seed.subject || "");
    const [inbox, sent] = await Promise.all([
      imapService.searchEmails({ folder: "INBOX", subject: normalized, limit: maxMsgs }),
      imapService.searchEmails({ folder: "Sent",  subject: normalized, limit: maxMsgs }).catch(() => [] as EmailMessage[]),
    ]);
    const byId = new Map<string, EmailMessage>();
    for (const m of [seed, ...inbox, ...sent]) {
      const normSubj = normalizeSubject(m.subject || "");
      if (normSubj !== normalized) continue;
      byId.set(m.id, m);
    }
    const messages = Array.from(byId.values())
      .sort((a, b) => (a.date?.getTime?.() ?? 0) - (b.date?.getTime?.() ?? 0))
      .slice(0, maxMsgs);
    return ok({ subject: normalized, messages });
  },

  get_correspondence_profile: async (ctx) => {
    const { args, analyticsService, ok, getAnalyticsEmails } = ctx;
    const emailArg = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
    if (!emailArg || !isValidEmail(emailArg)) {
      throw new McpError(ErrorCode.InvalidParams, "email must be a valid address.");
    }
    await getAnalyticsEmails().catch(() => null);
    const contacts = analyticsService.getContacts(500);
    const found = contacts.find(c => c.email.toLowerCase() === emailArg);
    if (!found) {
      return ok({
        email: emailArg,
        emailsSent: 0,
        emailsReceived: 0,
        firstInteraction: null,
        lastInteraction: null,
        averageResponseTime: null,
        isFavorite: false,
      }, `No prior correspondence with ${emailArg} in the analytics window.`);
    }
    return ok({
      email: found.email,
      name: found.name ?? "",
      emailsSent: found.emailsSent,
      emailsReceived: found.emailsReceived,
      firstInteraction: found.firstInteraction?.toISOString?.() ?? null,
      lastInteraction:  found.lastInteraction?.toISOString?.()  ?? null,
      averageResponseTime: found.averageResponseTime ?? null,
      isFavorite: !!found.isFavorite,
    });
  },

  fts_search: async (ctx) => {
    const { args, ok, getFts } = ctx;
    const q = typeof args.query === "string" ? args.query.trim() : "";
    if (!q) throw new McpError(ErrorCode.InvalidParams, "query must be a non-empty string.");
    let fts: FtsIndexService;
    try { fts = getFts(); } catch (err: unknown) {
      if (err instanceof FtsUnavailableError) throw new McpError(ErrorCode.InvalidRequest, err.message);
      throw err;
    }
    const hits = fts.search({
      query: q,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      folder: typeof args.folder === "string" ? args.folder : undefined,
      sinceEpoch: typeof args.sinceEpoch === "number" ? args.sinceEpoch : undefined,
    }).map(h => ({
      id: h.id,
      subject: h.subject,
      from: h.from,
      to: h.to,
      folder: h.folder,
      snippet: h.snippet,
      dateEpoch: h.dateEpoch,
      score: h.score,
    }));
    return ok({ hits });
  },

  fts_rebuild: async (ctx) => {
    const { ok, getFts, getAnalyticsEmails, recordFromEmail } = ctx;
    let fts: FtsIndexService;
    try { fts = getFts(); } catch (err: unknown) {
      if (err instanceof FtsUnavailableError) throw new McpError(ErrorCode.InvalidRequest, err.message);
      throw err;
    }
    const { inbox, sent } = await getAnalyticsEmails();
    fts.clear();
    const indexed = fts.upsertMany([...inbox, ...sent].map(recordFromEmail));
    const stats = fts.stats();
    return ok({ indexed, messageCount: stats.messageCount, dbPath: stats.dbPath });
  },

  fts_status: async (ctx) => {
    const { ok, getFts } = ctx;
    try {
      const fts = getFts();
      const stats = fts.stats();
      return ok({ available: true, ...stats });
    } catch (err: unknown) {
      if (err instanceof FtsUnavailableError) {
        return ok({ available: false, reason: err.message });
      }
      throw err;
    }
  },

  extract_action_items: async (ctx) => {
    const { args, imapService, ok } = ctx;
    const aiEmailId = requireNumericEmailId(args.email_id, "email_id");
    const email = await imapService.getEmailById(aiEmailId);
    if (!email) {
      return { content: [{ type: "text" as const, text: "Email not found" }], isError: true, structuredContent: { success: false, reason: "Email not found" } };
    }
    const action_items = extractActionItems(email.body || "");
    return ok({ action_items });
  },

  extract_meeting: async (ctx) => {
    const { args, imapService, ok } = ctx;
    const emEmailId = requireNumericEmailId(args.email_id, "email_id");
    const email = await imapService.getEmailById(emEmailId);
    if (!email) {
      return { content: [{ type: "text" as const, text: "Email not found" }], isError: true, structuredContent: { success: false, reason: "Email not found" } };
    }
    let icsText: string | null = null;
    for (const att of email.attachments ?? []) {
      const ct = (att.contentType ?? "").toLowerCase();
      const fn = (att.filename ?? "").toLowerCase();
      const looksIcs = ct.startsWith("text/calendar")
        || ct === "application/ics"
        || fn.endsWith(".ics");
      if (!looksIcs) continue;
      if (Buffer.isBuffer(att.content)) {
        icsText = att.content.toString("utf-8");
      } else if (typeof att.content === "string") {
        icsText = att.content;
      }
      if (icsText) break;
    }
    if (!icsText && email.body && /BEGIN:VCALENDAR/i.test(email.body)) {
      icsText = email.body;
    }
    const meeting = icsText ? parseIcs(icsText) : null;
    return ok({ meeting: meeting ?? null });
  },
};

const mod: ToolModule = { defs, handlers };
export default mod;
