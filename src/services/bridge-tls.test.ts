import { describe, it, expect } from "vitest";
import { buildBridgeTlsOptions } from "./bridge-tls.js";

describe("buildBridgeTlsOptions", () => {
  const cert = Buffer.from("FAKE_CERT");

  it("pins the provided cert as the CA", () => {
    const opts = buildBridgeTlsOptions(cert);
    expect((opts.ca as Buffer[])[0]).toBe(cert);
  });

  it("sets servername to localhost (Node 25 IP-literal SNI fix)", () => {
    const opts = buildBridgeTlsOptions(cert);
    expect(opts.servername).toBe("localhost");
  });

  it("enforces TLSv1.2 minimum", () => {
    const opts = buildBridgeTlsOptions(cert);
    expect(opts.minVersion).toBe("TLSv1.2");
  });

  it("bypasses checkServerIdentity (Bridge cert CN is 127.0.0.1, not localhost)", () => {
    const opts = buildBridgeTlsOptions(cert);
    expect(typeof opts.checkServerIdentity).toBe("function");
    expect((opts.checkServerIdentity as () => undefined)()).toBeUndefined();
  });
});
