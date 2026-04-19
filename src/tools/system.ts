/**
 * System & maintenance tools: get_connection_status, sync_emails,
 * clear_cache, get_logs.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateTargetFolder } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
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
    name: "get_connection_status",
    title: "Get Connection Status",
    description: "Check whether SMTP and IMAP connections to Proton Bridge are healthy. Returns connection status, TLS security mode (secure/insecure), and host/port details. Use this to diagnose connection issues before performing other operations.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        smtp: {
          type: "object",
          properties: {
            connected: { type: "boolean" },
            host: { type: "string" },
            port: { type: "number" },
            lastCheck: { type: "string", format: "date-time" },
            insecureTls: { type: "boolean" },
            backoff: {
              type: "object",
              description: "Abuse-signal backoff state. When active, sends are held back until remainingMs elapses.",
              properties: {
                active: { type: "boolean" },
                failureCount: { type: "number", description: "Consecutive throttle responses since the last success" },
                remainingMs: { type: "number", description: "Milliseconds remaining on the current backoff window" },
              },
            },
            initError: { type: "string", description: "Deferred SMTP initialization error (e.g. unreadable bridgeCertPath). When present, sends will fail with this message until config is fixed and reinitialize() runs." },
            error: { type: "string", description: "Last SMTP error message, if any" },
          },
        },
        imap: {
          type: "object",
          properties: {
            connected: { type: "boolean" },
            healthy: { type: "boolean" },
            host: { type: "string" },
            port: { type: "number" },
            insecureTls: { type: "boolean" },
          },
        },
        settingsConfigured: { type: "boolean", description: "Whether a settings config file exists on disk" },
        settingsConfigPath: { type: "string", description: "Absolute path to the settings config file" },
      },
    },
  },
  {
    name: "sync_emails",
    title: "Sync Emails",
    description: "Fetch the latest emails from IMAP into the local cache. Use this to refresh the cache after Bridge syncs new messages. Returns emails fetched; use get_emails for paginated access.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder to sync. Default: INBOX" },
        limit: { type: "number", description: "Max emails to fetch (1-500, default 100)", default: 100 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        folder: { type: "string" },
        count: { type: "number" },
      },
      required: ["success", "folder", "count"],
    },
  },
  {
    name: "clear_cache",
    title: "Clear Cache",
    description: "Clear all in-memory caches (email message cache, folder cache, analytics cache). Forces fresh IMAP fetches on next access. Use if you suspect stale data.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: ACTION_RESULT_SCHEMA,
  },
  {
    name: "get_logs",
    title: "Get Server Logs",
    description: "Retrieve recent server log entries filtered by level. Sensitive fields are redacted.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["debug", "info", "warn", "error"],
          description: "Filter by log level",
        },
        limit: { type: "number", description: "Max entries (max 500)", default: 100 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        logs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestamp: { type: "string", format: "date-time" },
              level: { type: "string", enum: ["debug", "info", "warn", "error"] },
              context: { type: "string" },
              message: { type: "string" },
              data: { description: "Optional structured metadata attached to the log entry (sensitive fields redacted)" },
            },
            required: ["timestamp", "level", "context", "message"],
          },
        },
      },
      required: ["logs"],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_connection_status: async (ctx) => {
    const { imapService, smtpService, ok, config, state } = ctx;
    const { configExists, getConfigPath } = await import("../config/loader.js");
    const smtpBackoffMs = smtpService.backoff.delayUntilMs();
    const status = {
      smtp: {
        connected: state.smtpStatus.connected,
        host: config.smtp.host,
        port: config.smtp.port,
        lastCheck: state.smtpStatus.lastCheck.toISOString(),
        insecureTls: smtpService.insecureTls,
        backoff: {
          active: smtpService.backoff.isBlocked(),
          failureCount: smtpService.backoff.failureCount,
          remainingMs: smtpBackoffMs,
        },
        ...(smtpService.initError ? { initError: smtpService.initError } : {}),
        ...(state.smtpStatus.error ? { error: state.smtpStatus.error } : {}),
      },
      imap: {
        connected: imapService.isActive(),
        healthy: await imapService.healthCheck(),
        host: config.imap.host,
        port: config.imap.port,
        insecureTls: imapService.insecureTls,
      },
      settingsConfigured: configExists(),
      settingsConfigPath: getConfigPath(),
    };
    const insecureTlsWarning = (smtpService.insecureTls || imapService.insecureTls)
      ? "\n\u26a0 TLS certificate validation is DISABLED \u2014 configure Bridge Certificate Path in Settings."
      : "";
    const backoffWarning = smtpService.backoff.isBlocked()
      ? `\n\u26a0 SMTP is in abuse-signal backoff (${smtpService.backoff.failureCount} consecutive throttle responses, ${smtpBackoffMs} ms remaining). Wait or have the user trigger a manual retry.`
      : "";
    const initErrorWarning = smtpService.initError
      ? `\n\u26a0 SMTP is not ready: ${smtpService.initError}`
      : "";
    return ok(status, JSON.stringify(status) + insecureTlsWarning + backoffWarning + initErrorWarning);
  },

  sync_emails: async (ctx) => {
    const { args, imapService, ok, state } = ctx;
    const folder = (args.folder as string) || "INBOX";
    const seValidErr = validateTargetFolder(folder);
    if (seValidErr) throw new McpError(ErrorCode.InvalidParams, seValidErr);
    if (args.limit !== undefined && typeof args.limit !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be a number.");
    }
    const limit = Math.min(Math.max(1, (args.limit as number) || 100), 500);
    const emails = await imapService.getEmails(folder, limit);
    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return ok({ success: true, folder, count: emails.length });
  },

  clear_cache: async (ctx) => {
    const { imapService, analyticsService, actionOk, state } = ctx;
    imapService.clearCache();
    analyticsService.clearCache();
    state.analyticsCache = null;
    state.analyticsCacheInflight = null;
    return actionOk();
  },

  get_logs: async (ctx) => {
    const { args, ok } = ctx;
    const VALID_LEVELS = new Set(["debug", "info", "warn", "error"]);
    if (args.level !== undefined && typeof args.level !== "string") {
      throw new McpError(ErrorCode.InvalidParams, "'level' must be a string when provided.");
    }
    const rawLevel = args.level as string | undefined;
    const level = rawLevel && VALID_LEVELS.has(rawLevel)
      ? (rawLevel as "debug" | "info" | "warn" | "error")
      : undefined;
    const rawLimit = typeof args.limit === "number" ? args.limit : 100;
    const limit   = Math.min(Math.max(1, Math.trunc(rawLimit)), 500);
    const logs    = logger.getLogs(level, limit);
    return ok({ logs });
  },
};

const mod: ToolModule = { defs, handlers };
export default mod;
