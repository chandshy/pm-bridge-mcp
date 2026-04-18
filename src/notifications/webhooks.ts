/**
 * Outbound webhook deliverer.
 *
 * Fires on grant-state transitions (pending, approved, denied, revoked,
 * expired) to user-configured HTTP endpoints. Three delivery "formats":
 *
 *   "cloudevents" (default)  — CloudEvents 1.0 JSON envelope. The most
 *                              interoperable choice; consumed by Knative,
 *                              Azure Event Grid, and most event routers.
 *   "slack"                  — Slack incoming-webhook shape ({ text,
 *                              blocks? }). Auto-selected when the URL
 *                              matches hooks.slack.com.
 *   "discord"                — Discord webhook shape ({ content,
 *                              embeds? }). Auto-selected for
 *                              discord.com/api/webhooks URLs.
 *   "raw"                    — Send the raw grant JSON.
 *
 * Signing: every delivery carries an `X-PMBridge-Signature-256` header
 * whose value is `sha256=<hex>` of HMAC(body, secret) — matches the
 * GitHub webhook convention. No signing happens when the endpoint has
 * no secret configured.
 *
 * Retries: exponential backoff (1 / 2 / 4 / 8 / 16 / 32 / 64 / 128 s)
 * with ±20 % jitter, max 8 attempts. After the final failure we log
 * at warn and drop — no DLQ yet.
 */

import { createHmac, randomBytes } from "crypto";
import { logger } from "../utils/logger.js";
import type { AgentGrant } from "../agents/types.js";
import type { GrantChangedEvent } from "../agents/notifications.js";

export type WebhookFormat = "cloudevents" | "slack" | "discord" | "raw";

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** Optional HMAC secret. When present, signs every body. */
  secret?: string;
  format?: WebhookFormat;       // defaults to "cloudevents" or auto-detected
  enabled?: boolean;            // default true
  /** Which event kinds to deliver. Defaults to all grant events. */
  subscribe?: Array<"grant-created" | "grant-approved" | "grant-denied" | "grant-revoked" | "grant-expired">;
}

const DEFAULT_SUBSCRIBE: NonNullable<WebhookEndpoint["subscribe"]> = [
  "grant-created", "grant-approved", "grant-denied", "grant-revoked", "grant-expired",
];

const MAX_ATTEMPTS = 8;
/** ms. First value is the initial wait; doubled each retry. */
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 128_000;

function jitter(base: number): number {
  // ±20 % jitter: multiplier in [0.8, 1.2].
  const mult = 0.8 + Math.random() * 0.4;
  return Math.min(Math.round(base * mult), MAX_DELAY_MS);
}

/** Auto-detect the best format from a URL when one isn't explicitly set. */
export function detectFormat(url: string): WebhookFormat {
  try {
    const u = new URL(url);
    if (u.hostname === "hooks.slack.com") return "slack";
    if (u.hostname === "discord.com" || u.hostname === "discordapp.com") return "discord";
  } catch { /* bad URL — caller will error on delivery */ }
  return "cloudevents";
}

/** Build the outgoing body for a given format + grant event. */
export function buildPayload(ev: GrantChangedEvent, format: WebhookFormat): Record<string, unknown> {
  const g = ev.grant;
  const action =
    ev.kind === "grant-created"  ? "requested access" :
    ev.kind === "grant-approved" ? "was approved" :
    ev.kind === "grant-denied"   ? "was denied" :
    ev.kind === "grant-revoked"  ? "was revoked" :
                                    "expired";
  const line = `Agent '${g.clientName}' ${action}.`;
  const detail = `preset: ${g.preset} · status: ${g.status}` +
    (g.conditions?.expiresAt ? ` · expires ${g.conditions.expiresAt}` : "");

  if (format === "slack") {
    return { text: `*pm-bridge-mcp* — ${line}\n${detail}` };
  }
  if (format === "discord") {
    return { content: `**pm-bridge-mcp** — ${line}\n${detail}` };
  }
  if (format === "raw") {
    return { kind: ev.kind, seq: ev.seq, grant: g };
  }
  // CloudEvents 1.0 envelope.
  return {
    specversion: "1.0",
    id: `pmb-${randomBytes(8).toString("hex")}`,
    source: "pm-bridge-mcp",
    type: `com.pmbridge.${ev.kind.replace("-", ".")}`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: {
      clientId: g.clientId,
      clientName: g.clientName,
      status: g.status,
      preset: g.preset,
      conditions: g.conditions,
      totalCalls: g.totalCalls,
    },
  };
}

function sign(body: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
  return `sha256=${mac}`;
}

export interface DeliveryResult {
  endpointId: string;
  url: string;
  ok: boolean;
  status?: number;
  attempts: number;
  lastError?: string;
}

export interface WebhookDispatcherDeps {
  /** Override fetch for tests. */
  fetcher?: typeof globalThis.fetch;
  /** Override sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class WebhookDispatcher {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: WebhookDispatcherDeps = {}) {
    this.fetcher = deps.fetcher ?? globalThis.fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  }

  /**
   * Deliver one event to one endpoint with retry/backoff. Resolves with
   * the final DeliveryResult; never rejects (failures logged + returned).
   */
  async deliver(endpoint: WebhookEndpoint, ev: GrantChangedEvent): Promise<DeliveryResult> {
    const subscribe = endpoint.subscribe ?? DEFAULT_SUBSCRIBE;
    if (!subscribe.includes(ev.kind as typeof DEFAULT_SUBSCRIBE[number])) {
      return { endpointId: endpoint.id, url: endpoint.url, ok: true, attempts: 0, lastError: "skipped_by_subscription" };
    }
    const format = endpoint.format ?? detectFormat(endpoint.url);
    const payload = buildPayload(ev, format);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "pm-bridge-mcp/1 (+https://github.com/chandshy/pm-bridge-mcp)",
    };
    if (endpoint.secret) headers["X-PMBridge-Signature-256"] = sign(body, endpoint.secret);

    let lastError = "";
    let status: number | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.fetcher(endpoint.url, { method: "POST", headers, body });
        status = res.status;
        if (res.ok) {
          return { endpointId: endpoint.id, url: endpoint.url, ok: true, status, attempts: attempt };
        }
        lastError = `HTTP ${res.status}`;
        // 4xx other than 408/429 is a permanent client error — stop retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          return { endpointId: endpoint.id, url: endpoint.url, ok: false, status, attempts: attempt, lastError };
        }
      } catch (err) {
        lastError = (err as Error).message;
      }
      if (attempt < MAX_ATTEMPTS) {
        const waitMs = jitter(Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS));
        await this.sleep(waitMs);
      }
    }
    logger.warn(`Webhook ${endpoint.id} exhausted ${MAX_ATTEMPTS} attempts: ${lastError}`, "Webhooks");
    return { endpointId: endpoint.id, url: endpoint.url, ok: false, status, attempts: MAX_ATTEMPTS, lastError };
  }

  /** Deliver to every enabled endpoint in parallel. Returns per-endpoint results. */
  async deliverAll(endpoints: WebhookEndpoint[], ev: GrantChangedEvent): Promise<DeliveryResult[]> {
    const active = endpoints.filter(e => e.enabled !== false);
    return Promise.all(active.map(e => this.deliver(e, ev)));
  }
}
