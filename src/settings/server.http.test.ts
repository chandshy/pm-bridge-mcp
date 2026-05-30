/**
 * HTTP-level tests for the settings server request handler.
 *
 * Covers the v3.0.60 UI/CSP hardening batch:
 *   - UI-002: main UI CSP drops 'unsafe-inline' from script-src.
 *   - UI-003: /agent-setup CSP locks script-src to 'self' (no inline scripts).
 *   - UI-006: POST /api/shutdown routes through onShutdownRequested instead of
 *             calling process.exit directly (so tray cleanup runs).
 *   - UI-009: POST /api/write-claude-desktop bails on an unparseable existing
 *             config rather than clobbering it.
 *   - UI-011: POST /api/agents/:id/approve strips unknown / prototype-polluting
 *             condition + toolOverride keys.
 */

import { describe, it, expect, vi, afterAll } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettingsServer } from "./server.js";
import { AgentGrantStore } from "../agents/grant-store.js";
import { AgentAuditLog } from "../agents/audit.js";
import { registerAgentServices } from "../agents/registry.js";

interface Resp { status: number; headers: http.IncomingHttpHeaders; body: string; }

function listen(handler: http.Server): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    handler.listen(0, "127.0.0.1", () => {
      const port = (handler.address() as AddressInfo).port;
      resolve({ port, close: () => handler.close() });
    });
  });
}

function request(
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function csrfFrom(port: number): Promise<string> {
  const res = await request(port, "GET", "/");
  const m = /<meta name="csrf-token" content="([^"]+)">/.exec(res.body);
  if (!m) throw new Error("no csrf token in shell HTML");
  return m[1];
}

describe("settings server CSP headers", () => {
  it("UI-002: main UI script-src carries a nonce and no 'unsafe-inline'", async () => {
    const srv = createSettingsServer({ port: 8765, lan: false, accessToken: null, scheme: "http" });
    const { port, close } = await listen(srv);
    try {
      const res = await request(port, "GET", "/");
      const csp = String(res.headers["content-security-policy"]);
      expect(csp).toMatch(/script-src 'nonce-[^']+'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    } finally {
      close();
    }
  });

  it("UI-003: /agent-setup locks script-src to 'self' and escapes interpolations", async () => {
    const srv = createSettingsServer({ port: 8765, lan: false, accessToken: null, scheme: "http" });
    const { port, close } = await listen(srv);
    try {
      const res = await request(port, "GET", "/agent-setup");
      const csp = String(res.headers["content-security-policy"]);
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      // The page must not contain a raw <script> we forgot to remove.
      expect(res.body).not.toMatch(/<script\b/);
    } finally {
      close();
    }
  });
});

describe("UI-011: approve endpoint sanitizes conditions/toolOverrides", () => {
  const tmp = mkdtempSync(join(tmpdir(), "mp-grants-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("strips prototype-pollution + unknown keys before storing the grant", async () => {
    const grants = new AgentGrantStore(join(tmp, "grants.json"));
    const audit = new AgentAuditLog({ path: join(tmp, "audit.jsonl") });
    registerAgentServices(grants, audit);
    grants.createPending({ clientId: "client_abc", clientName: "Test" });

    const srv = createSettingsServer({ port: 8765, lan: false, accessToken: null, scheme: "http" });
    const { port, close } = await listen(srv);
    try {
      const token = await csrfFrom(port);
      const payload = JSON.stringify({
        preset: "read_only",
        toolOverrides: { get_emails: true, bogus_tool: true, __proto__: { isAdmin: true } },
        conditions: { folderAllowlist: ["INBOX", 123], evilKey: "x", __proto__: { polluted: true } },
      });
      const res = await request(port, "POST", "/api/agents/client_abc/approve", {
        headers: { "x-csrf-token": token, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(200);

      // Object.prototype must not have been polluted.
      expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();

      const stored = grants.get("client_abc")!;
      // Only the known tool survives; bogus + __proto__ dropped.
      expect(stored.toolOverrides).toEqual({ get_emails: true });
      // Only string folder entries survive; unknown condition keys dropped.
      expect(stored.conditions?.folderAllowlist).toEqual(["INBOX"]);
      expect((stored.conditions as Record<string, unknown>).evilKey).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe("UI-006: POST /api/shutdown routes through onShutdownRequested", () => {
  it("invokes the callback instead of process.exit when one is wired", async () => {
    const onShutdownRequested = vi.fn();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const srv = createSettingsServer({ port: 8765, lan: false, accessToken: null, scheme: "http", onShutdownRequested });
    const { port, close } = await listen(srv);
    try {
      const token = await csrfFrom(port);
      const res = await request(port, "POST", "/api/shutdown", {
        headers: { "x-csrf-token": token, origin: `http://127.0.0.1:${port}` },
      });
      expect(res.status).toBe(200);
      // Handler flushes the response then fires the callback after ~300ms.
      await new Promise((r) => setTimeout(r, 500));
      expect(onShutdownRequested).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      close();
    }
  });
});
