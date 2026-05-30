/**
 * HTTP transport for mailpouch (remote / self-host mode).
 *
 * Spec reference: https://modelcontextprotocol.io/specification/2025-11-25
 *
 * Auth supports two modes that can be mixed on the same listener:
 *
 *   1. **Static bearer token** — programmatic use. The user configures
 *      `remoteBearerToken` in the settings file and clients present it
 *      as `Authorization: Bearer <token>`. This is the minimal deployment
 *      (me-on-my-phone talking to my laptop's Bridge over a trusted
 *      tunnel). Token is compared with timingSafeEqual.
 *
 *   2. **OAuth 2.1 + PKCE** — spec-compliant mode. When `oauthEnabled`
 *      is true the server also mounts the RFC 8414 authorization-server
 *      metadata, RFC 9728 protected-resource metadata, RFC 7591 Dynamic
 *      Client Registration endpoint, and the authorize/token/revoke
 *      endpoints. MCP hosts register themselves and obtain tokens via a
 *      human-in-the-loop consent screen gated on the admin password.
 *
 * Every unauthenticated path is rate-limited per IP. The authed /mcp
 * endpoint is rate-limited per token key so a compromised token can't
 * DoS Bridge.
 *
 * Requests without a valid credential get 401 with a `WWW-Authenticate`
 * header per RFC 6750.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync } from "fs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { logger } from "../utils/logger.js";
import { OAuthStore } from "./oauth-store.js";
import { OAuthHandlers } from "./oauth-handlers.js";
import { TokenBucketLimiter } from "./rate-limit.js";
import type { AgentGrantStore } from "../agents/grant-store.js";
import { notifications } from "../agents/notifications.js";
import { runWithCaller } from "../agents/caller-context.js";

export interface HttpTransportOptions {
  /** MCP server instance to wire the transport into. */
  server: McpServer;
  /** Bind host. Default 127.0.0.1 (localhost-only). Use 0.0.0.0 for LAN exposure. */
  host?: string;
  /** Port to listen on. */
  port: number;
  /** Shared bearer token the client must send in Authorization: Bearer ... */
  bearerToken: string;
  /** Path where the MCP endpoint lives. Default /mcp. */
  path?: string;
  /** Optional TLS cert/key paths for HTTPS. If omitted, serves over plain HTTP. */
  tlsCertPath?: string;
  tlsKeyPath?: string;
  /** Enable OAuth 2.1 authorization-server endpoints alongside the static bearer. */
  oauthEnabled?: boolean;
  /** Admin password required to complete the consent step. Required when oauthEnabled=true. */
  oauthAdminPassword?: string;
  /** Externally-visible issuer URL. When omitted we derive it from the bind host/port. */
  oauthIssuer?: string;
  /** Requests per second per client for rate limiting (default 20). */
  rateLimitPerSecond?: number;
  /** Burst size (default 40). */
  rateLimitBurst?: number;
  /**
   * Optional grant store to wire into DCR + authed tool calls. When set,
   * each new DCR client gets a pending AgentGrant, and the caller-context
   * dispatched to the MCP handler carries the client_id so the tool
   * dispatcher can consult per-agent permissions. When omitted, the
   * transport behaves as before (bearer-only, no per-agent gating).
   */
  agentGrants?: AgentGrantStore;
}

export interface HttpTransportHandle {
  /** URL of the MCP endpoint (http[s]://host:port/mcp). */
  url: string;
  /** OAuth issuer URL, present when OAuth is enabled. */
  issuer?: string;
  /** Stop accepting new connections and close existing ones. */
  close: () => Promise<void>;
}

import { constantTimeEqual } from "../utils/crypto.js";

/** Constant-time compare, safe against length-leak. */
const tokenMatches = constantTimeEqual;

function extractBearer(req: IncomingMessage): string | null {
  const raw = req.headers["authorization"];
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(\S+)$/i.exec(raw.trimEnd());
  return m ? m[1] : null;
}

async function readJsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error(`Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) { resolve(null); return; }
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? JSON.parse(text) : null);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Return the caller IP. Trusts `X-Forwarded-For` ONLY when the direct
 * peer is loopback — matches the comment in oauth-handlers.ts and makes
 * the `ipPins` grant condition usable behind a local reverse proxy
 * (Caddy, nginx, Cloudflare Tunnel).
 *
 * XFF is comma-separated "client, proxy1, proxy2, …"; we take the
 * left-most token (the original client). When any parse step fails or
 * the direct peer is not loopback, fall back to the socket address —
 * never fail open to an attacker-controlled header.
 */
export function clientIp(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? "0.0.0.0";
  // Only the exact loopback addresses qualify — earlier code accepted any
  // 127.x.x.x or any ::ffff:127.x.x.x form, which on dual-stack/containerized
  // setups let an attacker reaching the host from a non-loopback IPv6 address
  // spoof X-Forwarded-For. Reject any IPv4-mapped-loopback variant other than
  // ::ffff:127.0.0.1.
  const isLoopback =
    direct === "127.0.0.1" ||
    direct === "::1" ||
    direct === "::ffff:127.0.0.1";
  if (!isLoopback) return direct;
  const h = req.headers["x-forwarded-for"];
  const raw = Array.isArray(h) ? h[0] : h;
  if (!raw) return direct;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : direct;
}

/**
 * Start the HTTP MCP server. Resolves to a handle you can close on shutdown.
 */
export async function startHttpTransport(opts: HttpTransportOptions): Promise<HttpTransportHandle> {
  const host = opts.host ?? "127.0.0.1";
  const path = opts.path ?? "/mcp";

  if (!opts.bearerToken && !opts.oauthEnabled) {
    throw new Error("HTTP transport requires remoteBearerToken to be set in the config (or enable OAuth)");
  }

  const transport = new StreamableHTTPServerTransport({});
  await opts.server.connect(transport);

  // Rate limiters — one bucket per client IP for unauthed endpoints; one
  // bucket per token (sha256-fingerprint) for authed /mcp calls.
  const unauthLimiter = new TokenBucketLimiter({
    capacity: opts.rateLimitBurst ?? 40,
    refillPerSecond: opts.rateLimitPerSecond ?? 20,
  });
  const authLimiter = new TokenBucketLimiter({
    capacity: (opts.rateLimitBurst ?? 40) * 3,          // authed calls get a bigger bucket
    refillPerSecond: (opts.rateLimitPerSecond ?? 20) * 3,
  });

  // OAuth state (only populated when enabled).
  const scheme = opts.tlsCertPath && opts.tlsKeyPath ? "https" : "http";

  // XPORT-015: serving auth (static bearer or OAuth tokens) over plain HTTP on
  // a non-loopback bind sends credentials across the wire in cleartext. We
  // don't hard-refuse (some operators front the listener with a TLS-terminating
  // proxy and bind 0.0.0.0 behind it), but we log a loud warning so an
  // unintentional public-cleartext deployment is obvious in the logs.
  const isLoopbackBind = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if (scheme === "http" && !isLoopbackBind) {
    logger.warn(
      `Serving authentication over PLAIN HTTP on a non-loopback bind (${host}:${opts.port}). ` +
      `Bearer tokens and OAuth access tokens will cross the network in cleartext. ` +
      `Configure remoteTlsCertPath/remoteTlsKeyPath, bind to 127.0.0.1, or front the ` +
      `listener with a TLS-terminating reverse proxy.`,
      "HttpTransport",
    );
  }

  // XPORT-015: 0.0.0.0 is a wildcard bind address, not a routable host — it must
  // never appear in the RFC 8414 issuer / RFC 9728 resource metadata or every
  // well-behaved MCP host's discovery breaks. When no explicit issuer is set and
  // we'd otherwise derive 0.0.0.0, substitute loopback for the advertised URL.
  const issuerHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const derivedIssuer = `${scheme}://${issuerHost}:${opts.port}`;
  const issuer = opts.oauthIssuer ?? derivedIssuer;
  const oauthStore = new OAuthStore();
  // Invalidate outstanding access tokens immediately when a grant transitions
  // out of "active". Without this, a revoked agent's existing token stayed
  // valid up to OAUTH_ACCESS_TOKEN_TTL_MS (24 h).
  const unsubGrantChanges = notifications.subscribe((ev) => {
    if (ev.kind === "grant-revoked" || ev.kind === "grant-denied" || ev.kind === "grant-expired") {
      const n = oauthStore.revokeTokensForClient(ev.grant.clientId);
      if (n > 0) logger.info(`Revoked ${n} OAuth token(s) for client ${ev.grant.clientId} after ${ev.kind}`, "HTTPTransport");
    }
  });
  const oauthHandlers = opts.oauthEnabled && opts.oauthAdminPassword
    ? new OAuthHandlers(
        oauthStore,
        { issuer, resource: `${issuer}${path}`, adminPassword: opts.oauthAdminPassword },
        unauthLimiter,
        opts.agentGrants
          ? (c) => opts.agentGrants!.createPending({ clientId: c.client_id, clientName: c.client_name ?? "" })
          : undefined,
      )
    : null;

  if (opts.oauthEnabled && !opts.oauthAdminPassword) {
    throw new Error("OAuth is enabled but no oauthAdminPassword is set. Generate one or disable OAuth.");
  }

  const sweep = setInterval(() => {
    oauthStore.sweep();
    unauthLimiter.sweep();
    authLimiter.sweep();
  }, 60_000).unref();

  const listener = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `${scheme}://${host}:${opts.port}`);

    // Unauthenticated endpoints — all rate-limited per client IP.
    if (req.method === "GET" && url.pathname === "/health") {
      if (!unauthLimiter.take(`ip:${clientIp(req)}`)) {
        res.statusCode = 429; res.end(JSON.stringify({ error: "rate_limited" })); return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        status: "ok",
        transport: "streamable-http",
        oauth: !!oauthHandlers,
      }));
      return;
    }

    // OAuth endpoints — delegated to OAuthHandlers when enabled.
    if (oauthHandlers && (url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/.well-known/"))) {
      const result = await oauthHandlers.dispatch(req, res, url);
      if (result.handled) return;
    }

    if (url.pathname !== path) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const token = extractBearer(req);
    const caller = clientIp(req);
    let tokenKey: string | null = null;
    let ok = false;
    let isStaticBearer = false;
    let callerClientId = "bearer:static";
    let callerClientName = "Static bearer";

    // PERM-008: when OAuth is enabled, the static bearer is NOT accepted. A
    // static bearer authenticates as a single shared, fully-trusted identity
    // ("bearer:static") that bypasses the per-agent grant store and the agent
    // audit log entirely — if it leaks, every tool runs with zero per-agent
    // attribution. OAuth deployments must use per-client tokens (DCR + grant)
    // so each agent is independently gated, audited, and revocable. The static
    // bearer remains available only for non-OAuth deployments.
    if (token && opts.bearerToken && !oauthHandlers && tokenMatches(token, opts.bearerToken)) {
      ok = true;
      isStaticBearer = true;
      // XPORT-001: key the static-bearer rate bucket per caller IP, not a
      // single global "bearer:static" string. Otherwise every legitimate
      // user of the shared token (CLI, phone, laptop) competes for one
      // bucket and a single busy — or malicious — caller DoSes the rest.
      tokenKey = `bearer:static:${caller}`;
    } else if (token && oauthHandlers) {
      const rec = oauthStore.verifyToken(token);
      if (rec) {
        // Resource Indicators: if the token was bound to a resource, it
        // must match this endpoint's URL.
        const expectedResource = `${issuer}${path}`;
        if (rec.resource && rec.resource !== expectedResource) {
          res.statusCode = 401;
          res.setHeader("WWW-Authenticate", `Bearer realm="mailpouch", error="invalid_token", error_description="token resource does not match endpoint"`);
          res.end(JSON.stringify({ error: "invalid_token" }));
          return;
        }
        // IP pinning at the token layer: if the token recorded its issuing
        // IP, the request must come from the same IP. Closes the "issue from
        // loopback, replay from remote" vector even when no per-agent grant
        // has ipPins set.
        if (rec.issuedFromIp && rec.issuedFromIp !== caller) {
          res.statusCode = 401;
          res.setHeader("WWW-Authenticate", `Bearer realm="mailpouch", error="invalid_token", error_description="token issued for a different client IP"`);
          res.end(JSON.stringify({ error: "invalid_token" }));
          return;
        }
        ok = true;
        tokenKey = `oauth:${rec.clientId}`;
        callerClientId = rec.clientId;
        // Pull the human-readable client name from the DCR record when available.
        const dcr = oauthStore.getClient(rec.clientId);
        if (dcr?.client_name) callerClientName = dcr.client_name;
      }
    }

    if (!ok || !tokenKey) {
      res.statusCode = 401;
      res.setHeader("WWW-Authenticate",
        oauthHandlers
          ? `Bearer realm="mailpouch", resource_metadata="${issuer}/.well-known/oauth-protected-resource"`
          : 'Bearer realm="mailpouch"',
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }

    if (!authLimiter.take(tokenKey)) {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: "rate_limited" }));
      return;
    }

    try {
      const body = req.method === "GET" ? undefined : await readJsonBody(req);
      // Wrap the dispatcher in an async-local caller context so the tool
      // layer can identify the agent without threading it through every
      // function signature. Static bearer uses a well-known clientId so
      // the gate/audit can distinguish it from an unknown caller.
      await runWithCaller(
        {
          clientId: callerClientId,
          clientName: callerClientName,
          ip: caller,
          staticBearer: isStaticBearer,
        },
        async () => { await transport.handleRequest(req, res, body); },
      );
    } catch (err: unknown) {
      logger.error("HTTP transport request failed", "HttpTransport", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    }
  };

  const server = opts.tlsCertPath && opts.tlsKeyPath
    ? createSecureServer(
        { cert: readFileSync(opts.tlsCertPath), key: readFileSync(opts.tlsKeyPath) },
        listener,
      )
    : createServer(listener);

  await new Promise<void>((resolve, reject) => {
    const onErr = (err: Error) => { server.off("listening", onOk); reject(err); };
    const onOk = () => { server.off("error", onErr); resolve(); };
    server.once("error", onErr);
    server.once("listening", onOk);
    server.listen(opts.port, host);
  });

  const url = `${scheme}://${host}:${opts.port}${path}`;
  logger.info(
    `MCP HTTP transport listening at ${url}${oauthHandlers ? ` (OAuth enabled, issuer ${issuer})` : ""}`,
    "HttpTransport",
  );

  return {
    url,
    issuer: oauthHandlers ? issuer : undefined,
    close: async () => {
      clearInterval(sweep);
      unsubGrantChanges();
      try { await transport.close(); } catch { /* best effort */ }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
