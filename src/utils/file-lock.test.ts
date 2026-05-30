import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { withFileLock } from "./file-lock.js";

function tmpTarget(): string {
  return join(tmpdir(), `mailpouch-lock-${randomBytes(6).toString("hex")}.json`);
}

describe("withFileLock", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const t of cleanup.splice(0)) {
      rmSync(t, { force: true });
      rmSync(`${t}.lock`, { recursive: true, force: true });
    }
  });

  it("runs fn and returns its value", () => {
    const t = tmpTarget(); cleanup.push(t);
    const r = withFileLock(t, () => 42);
    expect(r).toBe(42);
  });

  it("releases the lock dir after fn completes", () => {
    const t = tmpTarget(); cleanup.push(t);
    withFileLock(t, () => { /* no-op */ });
    expect(existsSync(`${t}.lock`)).toBe(false);
  });

  it("releases the lock even when fn throws", () => {
    const t = tmpTarget(); cleanup.push(t);
    expect(() => withFileLock(t, () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(`${t}.lock`)).toBe(false);
  });

  it("breaks a stale lock (older than the stale window) and proceeds", async () => {
    const t = tmpTarget(); cleanup.push(t);
    // Plant an empty stale lock dir with a backdated mtime.
    const lockDir = `${t}.lock`;
    mkdirSync(lockDir);
    const { utimesSync } = await import("fs");
    const old = Date.now() - 60_000;
    utimesSync(lockDir, new Date(old), new Date(old));
    // Should break the stale lock and run fn.
    const r = withFileLock(t, () => "ran");
    expect(r).toBe("ran");
  });
});
