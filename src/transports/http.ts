/**
 * HTTP transport for pm-bridge-mcp (remote / self-host mode).
 *
 * Spec reference: https://modelcontextprotocol.io/specification/2025-11-25
 *
 * Authentication in this v1 is a **shared bearer token** that the user
 * configures via \`remoteBearerToken\` in the settings file. This is
 * deliberately simpler than full OAuth 2.1 + PKCE — most self-hosted
 * deployments only need "me on my phone talking to my laptop's Bridge
 * over a Tailscale tunnel." A follow-up PR can add an OAuth 2.1
 * authorization server on top of this transport for public deployments.
 *
 * The bearer token is compared with timingSafeEqual to avoid leaking it
 * through response-time analysis. Requests without a valid token get a
 * 401 with a `WWW-Authenticate: Bearer` header per RFC 6750.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createServer as createSecureServer } from "https";
import { readFileSync } from "fs";
import { timingSafeEqual } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { logger } from "../utils/logger.js";

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
}

export interface HttpTransportHandle {
  /** Scheme (http/https), host, port the server is actually listening on. */
  url: string;
  /** Stop accepting new connections and close existing ones. */
  close: () => Promise<void>;
}

/**
 * Constant-time compare a candidate token to the configured one.
 * Returns false when lengths differ (does NOT leak length via early-exit).
 */
function tokenMatches(actual: string, expected: string): boolean {
  if (!expected || !actual) return false;
  const a = Buffer.from(actual, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    // timingSafeEqual requires equal-length inputs — fall back to compare
    // a pair of equal-length dummy buffers so the caller path still runs
    // in ~constant time regardless of length mismatch.
    const pad = Buffer.alloc(b.length, 0);
    try { timingSafeEqual(pad, b); } catch { /* ignore */ }
    return false;
  }
  return timingSafeEqual(a, b);
}

function extractBearer(req: IncomingMessage): string | null {
  const raw = req.headers["authorization"];
  if (!raw || typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)\s*$/i.exec(raw);
  return m ? m[1] : null;
}

/**
 * Accumulate the request body into a single string and JSON.parse it once
 * the stream ends. Returns null for non-JSON bodies or empty bodies.
 */
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
 * Start the HTTP MCP server. Resolves to a handle you can close on shutdown.
 * Blocks the MCP server's internal call to transport.start() by connecting
 * it once the first message arrives — the StreamableHTTPServerTransport
 * manages per-request sessions internally.
 */
export async function startHttpTransport(opts: HttpTransportOptions): Promise<HttpTransportHandle> {
  const host = opts.host ?? "127.0.0.1";
  const path = opts.path ?? "/mcp";

  if (!opts.bearerToken) {
    throw new Error("HTTP transport requires remoteBearerToken to be set in the config");
  }

  const transport = new StreamableHTTPServerTransport({});
  await opts.server.connect(transport);

  const listener = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Health check (no auth required) — lets operators confirm the port is up
    // without exposing the authenticated endpoint.
    if (req.url === "/health" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "ok", transport: "streamable-http" }));
      return;
    }

    if (req.url !== path) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const token = extractBearer(req);
    if (!token || !tokenMatches(token, opts.bearerToken)) {
      res.statusCode = 401;
      res.setHeader("WWW-Authenticate", 'Bearer realm="pm-bridge-mcp"');
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }

    try {
      const body = req.method === "GET" ? undefined : await readJsonBody(req);
      await transport.handleRequest(req, res, body);
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

  const scheme = opts.tlsCertPath && opts.tlsKeyPath ? "https" : "http";
  const url = `${scheme}://${host}:${opts.port}${path}`;
  logger.info(`MCP HTTP transport listening at ${url}`, "HttpTransport");

  return {
    url,
    close: async () => {
      try { await transport.close(); } catch { /* best effort */ }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
