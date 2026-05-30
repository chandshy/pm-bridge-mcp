/**
 * CRED-008 — exclusive file-lock around config read-modify-write.
 *
 * Unlike loader.test.ts (which mocks fs), this suite runs against the REAL
 * filesystem so the O_EXCL lock, stale-lock reclamation, and reentrancy are
 * exercised end-to-end. The config path is pointed at a throwaway file inside
 * the home directory (getConfigPath() refuses paths outside $HOME).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, closeSync, openSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { saveConfig, withConfigWriteLock, withConfigWriteLockAsync, defaultConfig, invalidateConfigCache } from "./loader.js";

describe("config file lock (CRED-008)", () => {
  let dir: string;
  let cfgPath: string;
  let lockPath: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    // mkdtemp inside $HOME so getConfigPath()'s home-containment check passes.
    dir = mkdtempSync(join(homedir(), ".mailpouch-lock-test-"));
    cfgPath = join(dir, `cfg-${randomBytes(4).toString("hex")}.json`);
    lockPath = `${cfgPath}.lock`;
    savedEnv = process.env.MAILPOUCH_CONFIG;
    process.env.MAILPOUCH_CONFIG = cfgPath;
    invalidateConfigCache();
  });

  afterEach(() => {
    if (savedEnv !== undefined) process.env.MAILPOUCH_CONFIG = savedEnv;
    else delete process.env.MAILPOUCH_CONFIG;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saveConfig writes the file and leaves no lock behind", () => {
    const cfg = defaultConfig();
    cfg.connection.username = "alice@example.com";
    saveConfig(cfg);
    expect(existsSync(cfgPath)).toBe(true);
    expect(existsSync(lockPath)).toBe(false); // released in finally
    expect(JSON.parse(readFileSync(cfgPath, "utf-8")).connection.username).toBe("alice@example.com");
  });

  it("reclaims a STALE lock left by a crashed holder", () => {
    // Simulate a crashed holder: create the lock file and backdate its mtime
    // well past the staleness window.
    closeSync(openSync(lockPath, "w"));
    const old = Date.now() / 1000 - 3600; // 1h ago, in seconds
    require("fs").utimesSync(lockPath, old, old);

    const cfg = defaultConfig();
    cfg.connection.username = "bob@example.com";
    // Must NOT hang/throw — the stale lock is reclaimed.
    saveConfig(cfg);
    expect(JSON.parse(readFileSync(cfgPath, "utf-8")).connection.username).toBe("bob@example.com");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("is reentrant: saveConfig inside withConfigWriteLock reuses the held lock", () => {
    const cfg = defaultConfig();
    cfg.connection.username = "carol@example.com";
    expect(() =>
      withConfigWriteLock(() => {
        saveConfig(cfg); // inner acquisition must not deadlock on the outer lock
      })
    ).not.toThrow();
    expect(JSON.parse(readFileSync(cfgPath, "utf-8")).connection.username).toBe("carol@example.com");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("serializes concurrent read-modify-write so neither writer clobbers the other (CRED-008)", async () => {
    // Seed a config with two independent fields.
    const seed = defaultConfig();
    seed.connection.username = "start";
    saveConfig(seed);

    // Two racing writers, each doing a full load→modify→save under the lock.
    // Writer A sets username, writer B sets smtpToken. With proper locking the
    // final file contains BOTH mutations (no last-writer-wins clobber).
    const writerA = withConfigWriteLockAsync(async () => {
      const c = JSON.parse(readFileSync(cfgPath, "utf-8"));
      await Promise.resolve(); // yield, widening the race window
      c.connection.username = "alice";
      saveConfig(c);
    });
    const writerB = withConfigWriteLockAsync(async () => {
      const c = JSON.parse(readFileSync(cfgPath, "utf-8"));
      await Promise.resolve();
      c.connection.smtpToken = "tokenB";
      saveConfig(c);
    });

    await Promise.all([writerA, writerB]);

    const final = JSON.parse(readFileSync(cfgPath, "utf-8"));
    // The later writer read the earlier writer's result (serialized), so both
    // fields survive.
    expect(final.connection.username).toBe("alice");
    expect(final.connection.smtpToken).toBe("tokenB");
    expect(existsSync(lockPath)).toBe(false);
  });
});
