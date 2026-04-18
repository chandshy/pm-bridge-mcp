/**
 * Analytics tools: get_email_stats, get_email_analytics, get_contacts,
 * get_volume_trends.
 */

import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef, ToolHandler, ToolModule } from "./types.js";

export const defs: ToolDef[] = [
  {
    name: "get_email_stats",
    title: "Get Email Statistics",
    description:
      "Aggregate statistics across inbox and sent: totals, unread count, most active contact, storage estimate. Results cached for 5 minutes.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        totalEmails: { type: "number" },
        unreadEmails: { type: "number" },
        starredEmails: { type: "number" },
        totalFolders: { type: "number" },
        totalContacts: { type: "number" },
        averageEmailsPerDay: { type: "number" },
        mostActiveContact: { type: "string" },
        mostUsedFolder: { type: "string" },
        storageUsedMB: { type: "number" },
      },
      required: ["totalEmails", "unreadEmails", "totalContacts"],
    },
  },
  {
    name: "get_email_analytics",
    title: "Get Email Analytics",
    description:
      "Advanced analytics across inbox and sent: top senders/recipients, peak activity hours, attachment stats, and measured response times (null when insufficient data). Results cached for 5 minutes.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        volumeTrends: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              received: { type: "number" },
              sent: { type: "number" },
            },
          },
        },
        topSenders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              count: { type: "number", description: "Number of emails received from this sender" },
              lastContact: { type: "string", format: "date-time" },
            },
            required: ["email", "count", "lastContact"],
          },
        },
        topRecipients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              count: { type: "number", description: "Number of emails sent to this recipient" },
              lastContact: { type: "string", format: "date-time" },
            },
            required: ["email", "count", "lastContact"],
          },
        },
        responseTimeStats: {
          description: "Null when no sent replies could be matched to received emails.",
          oneOf: [
            {
              type: "object",
              properties: {
                average: { type: "number", description: "Average hours" },
                median: { type: "number" },
                fastest: { type: "number" },
                slowest: { type: "number" },
                sampleSize: { type: "number" },
              },
              required: ["average", "median", "fastest", "slowest", "sampleSize"],
            },
            { type: "null" },
          ],
        },
        peakActivityHours: {
          type: "array",
          items: {
            type: "object",
            properties: {
              hour: { type: "number", description: "Hour of day (0–23)" },
              count: { type: "number", description: "Number of emails in this hour" },
            },
            required: ["hour", "count"],
          },
        },
        attachmentStats: {
          type: "object",
          properties: {
            totalAttachments: { type: "number" },
            totalSizeMB: { type: "number" },
            averageSizeMB: { type: "number" },
            mostCommonTypes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", description: "MIME top-level type (e.g. image, application)" },
                  count: { type: "number" },
                },
                required: ["type", "count"],
              },
            },
          },
          required: ["totalAttachments", "totalSizeMB", "averageSizeMB", "mostCommonTypes"],
        },
      },
      required: ["volumeTrends", "topSenders", "topRecipients"],
    },
  },
  {
    name: "get_contacts",
    title: "Get Contacts",
    description:
      "Extract contact list from email history with send/receive counts and last-interaction dates. Includes contacts from both inbox and sent folders.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max contacts to return", default: 100 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        contacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              email: { type: "string" },
              name: { type: "string", description: "Display name if available" },
              emailsSent: { type: "number" },
              emailsReceived: { type: "number" },
              lastInteraction: { type: "string", format: "date-time" },
              firstInteraction: { type: "string", format: "date-time" },
              averageResponseTime: { type: "number", description: "Average response time in hours, if measurable" },
              isFavorite: { type: "boolean" },
            },
            required: ["email", "emailsSent", "emailsReceived"],
          },
        },
      },
      required: ["contacts"],
    },
  },
  {
    name: "get_volume_trends",
    title: "Get Volume Trends",
    description: "Get email send/receive volume per day over a time window. Returns daily counts of received and sent messages. Does not include unread counts — use get_unread_count for that.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days to include", default: 30 },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        trends: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "ISO 8601 date (YYYY-MM-DD)" },
              received: { type: "number" },
              sent: { type: "number" },
            },
            required: ["date", "received", "sent"],
          },
        },
      },
      required: ["trends"],
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_email_stats: async (ctx) => {
    const { analyticsService, ok, getAnalyticsEmails } = ctx;
    await getAnalyticsEmails();
    const stats = analyticsService.getEmailStats();
    return ok(stats as unknown as Record<string, unknown>);
  },

  get_email_analytics: async (ctx) => {
    const { analyticsService, ok, getAnalyticsEmails } = ctx;
    await getAnalyticsEmails();
    const analytics = analyticsService.getEmailAnalytics();
    return ok(analytics as unknown as Record<string, unknown>);
  },

  get_contacts: async (ctx) => {
    const { args, analyticsService, ok, limits, getAnalyticsEmails } = ctx;
    if (args.limit !== undefined && typeof args.limit !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'limit' must be a number.");
    }
    await getAnalyticsEmails();
    const contactLimit = Math.min((args.limit as number) || 100, limits.maxEmailListResults);
    const contacts = analyticsService.getContacts(contactLimit);
    return ok({ contacts });
  },

  get_volume_trends: async (ctx) => {
    const { args, analyticsService, ok, getAnalyticsEmails } = ctx;
    if (args.days !== undefined && typeof args.days !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "'days' must be a number.");
    }
    await getAnalyticsEmails();
    const trends = analyticsService.getVolumeTrends(args.days as number | undefined);
    return ok({ trends });
  },
};

const mod: ToolModule = { defs, handlers };
export default mod;
