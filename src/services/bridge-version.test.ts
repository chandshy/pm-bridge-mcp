/**
 * Tests for the Bridge version-floor probe issued after IMAP connect.
 * Verifies that the IMAP ID response is inspected, older versions warn,
 * and non-Bridge endpoints (or missing id()) are silently ignored.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SimpleIMAPService } from "./simple-imap-service.js";
import { logger } from "../utils/logger.js";

// Each test overrides ImapFlow to return a client with a specific id() response.
vi.mock("imapflow", () => {
  const ImapFlow = vi.fn(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      id: vi.fn().mockResolvedValue({}),
    };
  });
  return { ImapFlow };
});

vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));

async function connectWith(idResponse: Record<string, string> | null | "no-id-method" | "throws") {
  const { ImapFlow } = await import("imapflow");
  (ImapFlow as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
    const client: Record<string, unknown> = {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    if (idResponse === "throws") {
      client.id = vi.fn().mockRejectedValue(new Error("ID not supported"));
    } else if (idResponse !== "no-id-method") {
      client.id = vi.fn().mockResolvedValue(idResponse);
    }
    return client;
  });
  const svc = new SimpleIMAPService();
  await svc.connect("localhost", 1143, "user", "pass", undefined, undefined, true);
  // checkBridgeVersion is fire-and-forget — yield so it can settle.
  await new Promise((r) => setImmediate(r));
  return svc;
}

describe("checkBridgeVersion()", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy.mockClear();
    infoSpy.mockClear();
  });

  it("records the running Bridge version on the service", async () => {
    const svc = await connectWith({ name: "ProtonMail Bridge", version: "3.22.1" });
    expect(svc.bridgeVersion).toBe("3.22.1");
  });

  it("warns when the running Bridge is older than BRIDGE_MIN_VERSION", async () => {
    await connectWith({ name: "ProtonMail Bridge", version: "3.19.0" });
    const warned = warnSpy.mock.calls.some((c) => /older than the recommended minimum/.test(String(c[0])));
    expect(warned).toBe(true);
  });

  it("does not warn when the Bridge is at or above the floor", async () => {
    await connectWith({ name: "ProtonMail Bridge", version: "3.23.1" });
    const warned = warnSpy.mock.calls.some((c) => /older than the recommended minimum/.test(String(c[0])));
    expect(warned).toBe(false);
  });

  it("does not warn when the name does not look like Bridge (some other IMAP server)", async () => {
    await connectWith({ name: "Dovecot", version: "2.3.0" });
    const warned = warnSpy.mock.calls.some((c) => /older than the recommended minimum/.test(String(c[0])));
    expect(warned).toBe(false);
  });

  it("silently skips when the client has no id() method", async () => {
    const svc = await connectWith("no-id-method");
    expect(svc.bridgeVersion).toBeNull();
  });

  it("silently swallows errors from id()", async () => {
    const svc = await connectWith("throws");
    expect(svc.bridgeVersion).toBeNull();
  });

  it("silently skips when id() returns no version", async () => {
    const svc = await connectWith({ name: "ProtonMail Bridge" });
    expect(svc.bridgeVersion).toBeNull();
  });
});
