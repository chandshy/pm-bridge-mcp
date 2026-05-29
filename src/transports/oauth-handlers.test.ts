import { describe, it, expect } from "vitest";
import { sanitizeDcrClientName } from "./oauth-handlers.js";

describe("XPORT-002 sanitizeDcrClientName", () => {
  it("returns undefined for missing/empty/whitespace input", () => {
    expect(sanitizeDcrClientName(undefined)).toBeUndefined();
    expect(sanitizeDcrClientName("")).toBeUndefined();
    expect(sanitizeDcrClientName("   ")).toBeUndefined();
  });

  it("strips ASCII control characters and ANSI escape sequences", () => {
    // Mix of NUL, BEL, ESC, control-char run, ANSI color seqs.
    const dirty = "\x00\x07\x1b\x1b[31mClaude\x1b[0m\x01Desktop\x7f";
    expect(sanitizeDcrClientName(dirty)).toBe("ClaudeDesktop");
  });

  it("length-caps to 100 chars after stripping", () => {
    const long = "x".repeat(500);
    const out = sanitizeDcrClientName(long)!;
    expect(out.length).toBe(100);
  });

  it("preserves normal Unicode and punctuation", () => {
    expect(sanitizeDcrClientName("Cláudē Désktop 🎁 (v1)")).toBe("Cláudē Désktop 🎁 (v1)");
  });

  it("treats a name that becomes empty after stripping as missing", () => {
    expect(sanitizeDcrClientName("\x00\x07\x1b\x01")).toBeUndefined();
  });

  it("does not escape HTML chars — the consent renderer handles that separately", () => {
    expect(sanitizeDcrClientName("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});
