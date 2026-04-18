import { describe, it, expect, beforeEach } from "vitest";
import { OAuthStore, OAUTH_CODE_TTL_MS, OAUTH_ACCESS_TOKEN_TTL_MS } from "./oauth-store.js";

describe("OAuthStore", () => {
  let store: OAuthStore;

  beforeEach(() => {
    store = new OAuthStore();
  });

  describe("client registration", () => {
    it("registers a client with a generated ID and issued-at timestamp", () => {
      const c = store.registerClient({
        client_name: "Claude Desktop",
        redirect_uris: ["http://localhost:53134/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
      expect(c.client_id).toMatch(/^pmc_[0-9a-f]{32}$/);
      expect(c.client_id_issued_at).toBeGreaterThan(0);
      expect(c.client_name).toBe("Claude Desktop");
    });

    it("getClient returns the registered record and undefined for unknown IDs", () => {
      const c = store.registerClient({
        redirect_uris: ["http://localhost/cb"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });
      expect(store.getClient(c.client_id)?.client_id).toBe(c.client_id);
      expect(store.getClient("pmc_unknown")).toBeUndefined();
    });
  });

  describe("authorization codes", () => {
    it("issues a single-use code that consumeAuthCode redeems exactly once", () => {
      const issued = store.issueAuthCode({
        clientId: "c1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        scopes: ["mcp:full"],
      });
      expect(issued.code).toBeTruthy();

      const first = store.consumeAuthCode(issued.code);
      expect(first?.clientId).toBe("c1");

      const second = store.consumeAuthCode(issued.code);
      expect(second).toBeNull();
    });

    it("rejects an expired code (still deletes it)", () => {
      const issued = store.issueAuthCode({
        clientId: "c1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "x",
        codeChallengeMethod: "S256",
        scopes: [],
      });
      // Backdate the record so the TTL check fires.
      (issued as unknown as { createdAt: number }).createdAt = Date.now() - OAUTH_CODE_TTL_MS - 1;
      expect(store.consumeAuthCode(issued.code)).toBeNull();
    });

    it("consumeAuthCode returns null for unknown codes", () => {
      expect(store.consumeAuthCode("nope")).toBeNull();
    });
  });

  describe("access tokens", () => {
    it("issues a token that verifyToken resolves", () => {
      const t = store.issueToken({ clientId: "c1", scopes: ["mcp:full"] });
      expect(t.expiresAt - Date.now()).toBeCloseTo(OAUTH_ACCESS_TOKEN_TTL_MS, -3);

      const v = store.verifyToken(t.token);
      expect(v?.clientId).toBe("c1");
    });

    it("verifyToken returns null for unknown or expired tokens", () => {
      expect(store.verifyToken("unknown")).toBeNull();
      const t = store.issueToken({ clientId: "c1", scopes: [] });
      (t as unknown as { expiresAt: number }).expiresAt = Date.now() - 1;
      expect(store.verifyToken(t.token)).toBeNull();
    });

    it("revokeToken removes a live token", () => {
      const t = store.issueToken({ clientId: "c1", scopes: [] });
      expect(store.revokeToken(t.token)).toBe(true);
      expect(store.verifyToken(t.token)).toBeNull();
      expect(store.revokeToken(t.token)).toBe(false);
    });

    it("records the resource binding when provided", () => {
      const t = store.issueToken({ clientId: "c1", scopes: [], resource: "https://x.example.com/mcp" });
      expect(store.verifyToken(t.token)?.resource).toBe("https://x.example.com/mcp");
    });
  });

  describe("sweep / stats", () => {
    it("sweep() removes expired codes and tokens, leaves live ones alone", () => {
      const live = store.issueToken({ clientId: "c1", scopes: [] });
      const dead = store.issueToken({ clientId: "c1", scopes: [] });
      (dead as unknown as { expiresAt: number }).expiresAt = Date.now() - 1_000;
      const swept = store.sweep();
      expect(swept.tokens).toBe(1);
      expect(store.verifyToken(live.token)).not.toBeNull();
      expect(store.verifyToken(dead.token)).toBeNull();
    });

    it("stats reports current counts", () => {
      store.registerClient({ redirect_uris: ["http://x/cb"], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" });
      store.issueToken({ clientId: "c", scopes: [] });
      store.issueAuthCode({ clientId: "c", redirectUri: "http://x/cb", codeChallenge: "x", codeChallengeMethod: "S256", scopes: [] });
      const s = store.stats();
      expect(s).toEqual({ clients: 1, codes: 1, tokens: 1 });
    });
  });

  describe("absolute caps (DoS resistance)", () => {
    it("evicts the oldest token when the cap is reached", async () => {
      const { OAUTH_MAX_TOKENS } = await import("./oauth-store.js");
      const first = store.issueToken({ clientId: "c1", scopes: [] });
      // Fill to exactly the cap, then add one more → first should be gone.
      for (let i = 0; i < OAUTH_MAX_TOKENS; i++) {
        store.issueToken({ clientId: `c${i + 2}`, scopes: [] });
      }
      expect(store.verifyToken(first.token)).toBeNull();
      expect(store.stats().tokens).toBeLessThanOrEqual(OAUTH_MAX_TOKENS);
    });

    it("evicts the oldest code when the cap is reached", async () => {
      const { OAUTH_MAX_CODES } = await import("./oauth-store.js");
      const first = store.issueAuthCode({ clientId: "c", redirectUri: "http://x/cb", codeChallenge: "x", codeChallengeMethod: "S256", scopes: [] });
      for (let i = 0; i < OAUTH_MAX_CODES; i++) {
        store.issueAuthCode({ clientId: "c", redirectUri: "http://x/cb", codeChallenge: "x", codeChallengeMethod: "S256", scopes: [] });
      }
      expect(store.consumeAuthCode(first.code)).toBeNull();
      expect(store.stats().codes).toBeLessThanOrEqual(OAUTH_MAX_CODES);
    });
  });
});
