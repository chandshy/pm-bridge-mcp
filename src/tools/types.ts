/**
 * Boundary types for the per-category tool modules under src/tools/.
 *
 * The CallToolRequest handler in src/index.ts resolves account routing,
 * permission gates, destructive-confirm, and response-size limits, then
 * invokes the per-tool handler with a fully-populated ToolCallContext.
 * Handlers never touch module-level singletons directly — they read
 * everything they need from ctx, which keeps the boundary explicit and
 * makes it safe to hot-swap services (e.g. per-account routing).
 */

import type { SimpleIMAPService } from "../services/simple-imap-service.js";
import type { SMTPService } from "../services/smtp-service.js";
import type { SimpleLoginService } from "../services/simplelogin-service.js";
import type { AnalyticsService } from "../services/analytics-service.js";
import type { SchedulerService } from "../services/scheduler.js";
import type { ReminderService } from "../services/reminder-service.js";
import type { PassService } from "../services/pass-service.js";
import type { FtsIndexService, FtsRecord } from "../services/fts-service.js";
import type { ProtonMailConfig, EmailMessage } from "../types/index.js";

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  annotations?: Record<string, unknown>;
  inputSchema: unknown;
  outputSchema?: unknown;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

/** Mutable shared state that several handlers mutate in-place. */
export interface ToolSharedState {
  analyticsCache: { inbox: EmailMessage[]; sent: EmailMessage[]; fetchedAt: number } | null;
  analyticsCacheInflight: Promise<{ inbox: EmailMessage[]; sent: EmailMessage[] }> | null;
  bridgeAutoStarted: boolean;
  smtpStatus: { connected: boolean; lastCheck: Date; error?: string };
}

/** Per-call context injected by the dispatcher into every handler. */
export interface ToolCallContext {
  /** Arguments forwarded from the MCP client. */
  args: Record<string, unknown>;

  /** Per-call resolved services (honor `account_id` routing). */
  imapService: SimpleIMAPService;
  smtpService: SMTPService;

  /** Module-level singletons — never re-bound per call. */
  simpleloginService: SimpleLoginService;
  analyticsService: AnalyticsService;
  schedulerService: SchedulerService;
  reminderService: ReminderService;
  /** Lazy-initialized; handlers must call getPassService()/check ctx.passService for null. */
  passService: PassService | null;
  /** Lazy accessor for the FTS index — may throw FtsUnavailableError. */
  getFts: () => FtsIndexService;

  /** Live server config (SMTP host/port/username for reply-to, etc.). */
  config: ProtonMailConfig;

  /** Response limits — hot-reloaded from config, provided by the gate. */
  limits: {
    maxResponseBytes: number;
    maxEmailBodyChars: number;
    maxEmailListResults: number;
    maxAttachmentBytes: number;
    warnOnLargeResponse: boolean;
  };

  /** Response helpers — enforce size limits + shape. */
  ok: (structured: Record<string, unknown>, text?: string) => ToolResult;
  actionOk: (messageId?: string) => ToolResult;
  bulkOk: (result: { success: number; failed: number; errors: string[] }) => ToolResult;
  sendProgress: (progress: number, total: number, message: string) => Promise<void>;

  /** Shared cursors (email-list pagination). */
  encodeCursor: (c: { folder: string; offset: number; limit: number }) => string;
  decodeCursor: (token: string) => { folder: string; offset: number; limit: number } | null;

  /** Analytics cache warmer — shared across handlers that need it. */
  getAnalyticsEmails: () => Promise<{ inbox: EmailMessage[]; sent: EmailMessage[] }>;
  recordFromEmail: (m: EmailMessage) => FtsRecord;

  /** Bridge lifecycle helpers (start_bridge / shutdown_server / restart_server). */
  launchProtonBridge: () => Promise<void>;
  killProtonBridge: () => Promise<void>;
  isBridgeReachable: (host: string, port: number, timeoutMs?: number) => Promise<boolean>;
  gracefulShutdown: (signal: string) => Promise<void>;

  /** Diagnostic helper — shared across error paths. */
  safeErrorMessage: (error: unknown) => string;

  /** Shared constants + mutable state. */
  MAX_BULK_IDS: number;
  MAX_BODY_LENGTH: number;
  MAX_SUBJECT_LENGTH: number;
  state: ToolSharedState;
}

export type ToolHandler = (ctx: ToolCallContext) => Promise<ToolResult>;

export interface ToolModule {
  /** Tool definitions exposed through ListTools. */
  defs: ToolDef[];
  /** Handlers keyed by tool name — dispatcher looks up by request.params.name. */
  handlers: Record<string, ToolHandler>;
}
