import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, sep } from "path";
import {
  acquireSingletonLock,
  releaseSingletonLock,
  lockPathForAccount,
} from "./singleton-lock.js";

// Drive the lock path through the MAILPOUCH_LOCK_PATH override (homeFile
// requires it stay within $HOME) so the suite writes into a temp dir under
// HOME instead of the real ~/.mailpouch-*.lock.
describe("singleton-lock", () => {
  const ENV = "MAILPOUCH_LOCK_PATH";
  const HOME = "HOME";
  const origEnv = process.env[ENV];
  const origHome = process.env[HOME];
  let dir: string;
  let lockFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mp-lock-"));
    // homeFile validates against homedir(); point HOME at our temp dir so the
    // override is considered "inside HOME".
    process.env[HOME] = dir;
    lockFile = join(dir, "test.lock");
    process.env[ENV] = lockFile;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env[ENV]; else process.env[ENV] = origEnv;
    if (origHome === undefined) delete process.env[HOME]; else process.env[HOME] = origHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires when the lock is free and records our pid", () => {
    const r = acquireSingletonLock("user@proton.me", 4321);
    expect(r.status).toBe("acquired");
    if (r.status === "acquired") expect(r.reclaimed).toBe(false);
    expect(readFileSync(lockFile, "utf8")).toBe("4321");
  });

  it("signals held-by-live-instance when a LIVE pid holds the lock", () => {
    // process.pid is, by definition, alive.
    writeFileSync(lockFile, String(process.pid));
    const r = acquireSingletonLock("user@proton.me", process.pid + 1);
    expect(r.status).toBe("held-by-live-instance");
    if (r.status === "held-by-live-instance") expect(r.pid).toBe(process.pid);
  });

  it("reclaims a stale lock whose recorded pid is dead", () => {
    // PID 2^31-1 is effectively never a live process.
    writeFileSync(lockFile, "2147483646");
    const r = acquireSingletonLock("user@proton.me", 777);
    expect(r.status).toBe("acquired");
    if (r.status === "acquired") expect(r.reclaimed).toBe(true);
    expect(readFileSync(lockFile, "utf8")).toBe("777");
  });

  it("reclaims a garbage/non-numeric lock file", () => {
    writeFileSync(lockFile, "not-a-pid");
    const r = acquireSingletonLock("user@proton.me", 999);
    expect(r.status).toBe("acquired");
    expect(readFileSync(lockFile, "utf8")).toBe("999");
  });

  it("release removes the lock when we still own it", () => {
    const r = acquireSingletonLock("user@proton.me", 4321);
    expect(r.status).toBe("acquired");
    if (r.status !== "acquired") throw new Error("unexpected");
    releaseSingletonLock(r.path, 4321);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("release does NOT remove a lock another pid re-took", () => {
    const r = acquireSingletonLock("user@proton.me", 4321);
    if (r.status !== "acquired") throw new Error("unexpected");
    // Simulate another instance re-acquiring after we were considered stale.
    writeFileSync(lockFile, "5555");
    releaseSingletonLock(r.path, 4321);
    expect(existsSync(lockFile)).toBe(true);
    expect(readFileSync(lockFile, "utf8")).toBe("5555");
  });

  it("release is a no-op when the lock is already gone", () => {
    expect(() => releaseSingletonLock(lockFile, 4321)).not.toThrow();
  });

  describe("lockPathForAccount", () => {
    it("derives a stable, hashed, HOME-relative path per identity", () => {
      delete process.env[ENV]; // exercise the non-override branch
      const a = lockPathForAccount("user@proton.me");
      const b = lockPathForAccount("user@proton.me");
      const c = lockPathForAccount("other@proton.me");
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a.startsWith(dir + sep)).toBe(true);
      expect(a).not.toContain("user@proton.me"); // identity is hashed, not leaked
    });

    it("normalizes case/whitespace and buckets empty identity to default", () => {
      delete process.env[ENV];
      expect(lockPathForAccount("  User@Proton.ME ")).toBe(lockPathForAccount("user@proton.me"));
      expect(lockPathForAccount("")).toBe(lockPathForAccount(null));
      expect(lockPathForAccount(undefined)).toBe(lockPathForAccount(""));
    });
  });
});
