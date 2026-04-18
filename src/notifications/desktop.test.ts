import { describe, it, expect, vi } from "vitest";
import { DesktopNotifier } from "./desktop.js";

function makeRunner() {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner = vi.fn(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return { code: 0 };
  });
  return { runner, calls };
}

describe("DesktopNotifier", () => {
  describe("macOS", () => {
    it("invokes osascript with an AppleScript display-notification command", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "darwin", runner });
      const r = await n.notify({ title: "Hello", body: "World" });
      expect(r.ok).toBe(true);
      expect(r.platform).toBe("darwin");
      expect(calls).toHaveLength(1);
      expect(calls[0].cmd).toBe("osascript");
      expect(calls[0].args[0]).toBe("-e");
      expect(calls[0].args[1]).toContain(`display notification "World"`);
      expect(calls[0].args[1]).toContain(`with title "Hello"`);
    });

    it("includes subtitle + sound name when supplied", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "darwin", runner });
      await n.notify({ title: "T", body: "B", subtitle: "S", sound: "Glass" });
      expect(calls[0].args[1]).toContain(`subtitle "S"`);
      expect(calls[0].args[1]).toContain(`sound name "Glass"`);
    });

    it("escapes embedded quotes in the AppleScript literal", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "darwin", runner });
      await n.notify({ title: `He said "hi"`, body: "It works" });
      expect(calls[0].args[1]).toContain(`He said \\"hi\\"`);
    });

    it("returns ok:false when osascript exits non-zero", async () => {
      const runner = vi.fn(async () => ({ code: 1 }));
      const n = new DesktopNotifier({ platform: "darwin", runner });
      const r = await n.notify({ title: "T", body: "B" });
      expect(r.ok).toBe(false);
      expect(r.reason).toContain("osascript exit 1");
    });
  });

  describe("Linux", () => {
    it("invokes notify-send with title and body", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "linux", runner });
      const r = await n.notify({ title: "T", body: "B" });
      expect(r.ok).toBe(true);
      expect(calls[0].cmd).toBe("notify-send");
      expect(calls[0].args).toContain("T");
      expect(calls[0].args).toContain("B");
    });

    it("folds subtitle into the body (notify-send has no subtitle field)", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "linux", runner });
      await n.notify({ title: "T", body: "B", subtitle: "Sub" });
      const merged = calls[0].args.find(a => a.includes("Sub") && a.includes("B"));
      expect(merged).toBeTruthy();
    });

    it("reports a friendly reason when notify-send is missing (code -1)", async () => {
      const runner = vi.fn(async () => ({ code: -1 }));
      const n = new DesktopNotifier({ platform: "linux", runner });
      const r = await n.notify({ title: "T", body: "B" });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/notify-send not available/);
    });
  });

  describe("Windows", () => {
    it("invokes PowerShell with a WinRT toast XML payload", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "win32", runner });
      const r = await n.notify({ title: "T", body: "B" });
      expect(r.ok).toBe(true);
      expect(calls[0].cmd).toBe("powershell.exe");
      expect(calls[0].args.join(" ")).toContain("ToastNotification");
      expect(calls[0].args.join(" ")).toContain("<text>T</text>");
      expect(calls[0].args.join(" ")).toContain("<text>B</text>");
    });

    it("suppresses audio when sound: false", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "win32", runner });
      await n.notify({ title: "T", body: "B", sound: false });
      expect(calls[0].args.join(" ")).toContain("audio silent=");
    });

    it("escapes single quotes in the XML (PowerShell literal safety)", async () => {
      const { runner, calls } = makeRunner();
      const n = new DesktopNotifier({ platform: "win32", runner });
      await n.notify({ title: "don't", body: "ok" });
      // The XML is embedded in a single-quoted PS string; internal single
      // quotes must be doubled. Our `don't` becomes `don''t` in the output.
      expect(calls[0].args.join(" ")).toContain("don''t");
    });
  });

  it("reports unsupported_platform for unknown platforms", async () => {
    const n = new DesktopNotifier({ platform: "freebsd" as NodeJS.Platform, runner: vi.fn() });
    const r = await n.notify({ title: "T", body: "B" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported_platform");
  });

  it("catches runner throws and returns a structured error", async () => {
    const runner = vi.fn(() => { throw new Error("boom"); });
    const n = new DesktopNotifier({ platform: "darwin", runner });
    const r = await n.notify({ title: "T", body: "B" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("boom");
  });
});
