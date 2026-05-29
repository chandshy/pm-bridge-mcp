import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { homedir } from "os";
import { sep } from "path";
import { homeFile } from "./home-path.js";

describe("homeFile (CRED-002 containment)", () => {
  const ENV = "MAILPOUCH_TEST_PATH";
  const original = process.env[ENV];

  beforeEach(() => { delete process.env[ENV]; });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
  });

  it("returns $HOME/basename when env var unset", () => {
    const p = homeFile(ENV, ".mailpouch-thing");
    expect(p).toBe(`${homedir()}${sep}.mailpouch-thing`);
  });

  it("returns the resolved env path when it stays inside $HOME", () => {
    process.env[ENV] = `${homedir()}/sub/thing.json`;
    const p = homeFile(ENV, "fallback.json");
    expect(p).toBe(`${homedir()}${sep}sub${sep}thing.json`);
  });

  it("throws when env path traverses out of $HOME via ..", () => {
    process.env[ENV] = `${homedir()}/../etc/cron.d/foo`;
    expect(() => homeFile(ENV, "fallback")).toThrow(/must point to a path within the home directory/);
  });

  it("throws when env path is an absolute path outside $HOME", () => {
    process.env[ENV] = "/tmp/leak.jsonl";
    expect(() => homeFile(ENV, "fallback")).toThrow(/must point to a path within the home directory/);
  });

  it("throws on a path that resolves to / via redundant ..", () => {
    process.env[ENV] = "/../../../etc/passwd";
    expect(() => homeFile(ENV, "fallback")).toThrow(/must point to a path within the home directory/);
  });

  it("error message names the env var and the bad path", () => {
    process.env[ENV] = "/tmp/x";
    let caught: Error | null = null;
    try { homeFile(ENV, "fallback"); } catch (e) { caught = e as Error; }
    expect(caught).toBeTruthy();
    expect(caught!.message).toContain(ENV);
    expect(caught!.message).toContain("/tmp/x");
  });
});
