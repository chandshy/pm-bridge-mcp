/**
 * Cross-platform tray-icon facade shared by the MCP server (src/index.ts)
 * and the standalone settings daemon (src/settings-main.ts).
 *
 * Two backends with automatic selection:
 *
 *   1. **Native** — a tauri-apps/tray-icon Rust crate wrapped via
 *      napi-rs (`native/tray/`). Renders correctly on modern GNOME
 *      (proper IconThemePath + .png file extension), macOS NSStatusBar,
 *      and Win32 Shell_NotifyIcon. Preferred when a prebuilt for the
 *      current platform is present.
 *   2. **systray2 (legacy)** — Go-binary fallback. Has a known GNOME
 *      rendering bug (3-dot ellipsis instead of the icon) but works on
 *      macOS / Windows when the native prebuilt isn't available.
 *
 * Selection is automatic in `createTray()`: try native, fall back to
 * systray2 on `require()` failure or on a `loadError`. systray2's
 * boot hygiene (chmod the binary, skip headless hosts) lives in
 * `preflightTrayBinary()` / `trayPreconditionSkip()` below — those
 * helpers are still exported for direct callers that want to gate
 * tray init themselves.
 */
import { existsSync, chmodSync } from "fs";
import { homedir } from "os";
import nodePath from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const _require = createRequire(import.meta.url);

// ─── Native backend (tauri-apps/tray-icon via napi-rs) ───────────────────

/**
 * Generic tray handle returned by `createTray()`. Same shape regardless
 * of which backend is in use, so callers don't branch on backend type.
 */
export interface TrayHandle {
  /** Update the menu items in place. */
  setMenu(items: TrayItem[]): void;
  /** Replace the tray icon (PNG bytes). */
  setIcon(pngBytes: Buffer): void;
  /** Update the hover tooltip. */
  setTooltip(tooltip: string): void;
  /** Tear down the tray. Idempotent. */
  destroy(): void;
  /** Diagnostic label — "native" or "systray2". */
  readonly backend: "native" | "systray2";
}

export interface TrayItem {
  id: string;
  label: string;
  enabled?: boolean;
  separator?: boolean;
}

export interface CreateTrayOptions {
  iconPng: Buffer;
  tooltip: string;
  items: TrayItem[];
  /** Called with the activated item's `id` whenever the user clicks. */
  onClick: (id: string) => void;
}

interface NativeTrayConstructor {
  new (
    iconPng: Buffer,
    tooltip: string,
    items: TrayItem[],
    onClick: (id: string) => void,
  ): NativeTrayInstance;
}
interface NativeTrayInstance {
  setMenu(items: TrayItem[]): void;
  setIcon(png: Buffer): void;
  setTooltip(tooltip: string): void;
  destroy(): void;
}
interface NativeTrayModule { Tray: NativeTrayConstructor }

/**
 * Try to load the native tray addon. Returns null if unavailable —
 * happens when no prebuilt exists for the current platform/arch (the
 * built distribution ships @mailpouch/tray-native-* via npm
 * `optionalDependencies`; npm only installs the matching one).
 *
 * Module location resolution:
 *   1. `@mailpouch/tray-native` — npm-published addon (production)
 *   2. `../../native/tray` relative to compiled `dist/utils/tray.js`
 *      — the in-repo build for development (cargo build inside
 *      native/tray/ produces index.js + the .node sibling)
 */
function _loadNativeTray(): NativeTrayModule | null {
  const candidates = [
    "@mailpouch/tray-native",
    // dist/utils/tray.js — go up two to reach the project root, then
    // into native/tray. Three `..` would over-shoot to /mnt/data/Code/.
    nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..", "..", "native", "tray"),
  ];
  for (const id of candidates) {
    try {
      const mod = _require(id) as NativeTrayModule;
      if (mod && typeof mod.Tray === "function") return mod;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// ─── systray2 (legacy backend) preflight helpers ────────────────────────

function _binaryBasename(platform: NodeJS.Platform): string {
  return platform === "win32"  ? "tray_windows_release.exe"
       : platform === "darwin" ? "tray_darwin_release"
       :                         "tray_linux_release";
}

/**
 * Resolve + chmod 0755 the systray2 native binary in both possible
 * locations (package source, runtime cache). Idempotent; no-op on
 * Windows. Returns the source path inside node_modules, or null when
 * systray2 isn't installed / isn't resolvable.
 */
export function preflightTrayBinary(platform: NodeJS.Platform = process.platform): string | null {
  const basename = _binaryBasename(platform);
  let resolvedSource: string | null = null;
  try {
    const moduleDir = nodePath.dirname(_require.resolve("systray2/package.json"));
    const srcPath = nodePath.join(moduleDir, "traybin", basename);
    if (existsSync(srcPath)) {
      resolvedSource = srcPath;
      if (platform !== "win32") {
        try { chmodSync(srcPath, 0o755); } catch { /* non-fatal */ }
      }
    }
  } catch { /* systray2 not installed */ }
  if (platform !== "win32") {
    try {
      const pkg = _require("systray2/package.json") as { version?: string };
      const version = pkg.version ?? "0";
      const cachePath = nodePath.join(
        homedir(), ".cache", "node-systray", version, basename,
      );
      if (existsSync(cachePath)) {
        try { chmodSync(cachePath, 0o755); } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }
  return resolvedSource;
}

/**
 * Return a one-line DEBUG reason to skip tray startup, or null if the
 * host looks capable. Callers should log the reason and return before
 * spawning systray2 to avoid blocked reads / scary WARNs on headless
 * hosts.
 */
export function trayPreconditionSkip(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return "no display environment (DISPLAY / WAYLAND_DISPLAY unset) — tray skipped";
  }
  if ((platform === "darwin" || platform === "linux") && arch === "arm64") {
    const bin = preflightTrayBinary(platform);
    if (!bin) {
      return `arm64 ${platform} host — systray2 ships x86_64 binaries only; tray disabled (run via Rosetta, or see systray2 upstream for arm64 builds)`;
    }
  }
  return null;
}

// ─── Unified tray facade ────────────────────────────────────────────────

/**
 * Create a system-tray icon. Picks the best available backend:
 *   1. Native (tauri-apps/tray-icon via napi-rs) when the prebuilt is
 *      installed for this platform — proper rendering on modern GNOME,
 *      retina-aware on macOS, hi-DPI on Windows.
 *   2. systray2 fallback when the native prebuilt isn't available
 *      (happens during development before CI publishes prebuilts, or
 *      on niche platforms we haven't built for).
 *
 * Throws when neither backend can be used (headless host with no
 * display, ARM Mac without Rosetta, etc.). Callers should treat the
 * tray as a nice-to-have and catch the error to log + continue
 * without it.
 */
export function createTray(opts: CreateTrayOptions): TrayHandle {
  const native = _loadNativeTray();
  if (native) {
    const inst = new native.Tray(opts.iconPng, opts.tooltip, opts.items, opts.onClick);
    return {
      backend: "native",
      setMenu: (items) => inst.setMenu(items),
      setIcon: (bytes) => inst.setIcon(bytes),
      setTooltip: (s) => inst.setTooltip(s),
      destroy: () => inst.destroy(),
    };
  }
  return _createSystray2Fallback(opts);
}

/**
 * Adapter that wraps the legacy systray2 module behind the unified
 * TrayHandle interface. Kept here (not exposed) so all the
 * platform-quirky systray2 nuances stay isolated to one file.
 */
function _createSystray2Fallback(opts: CreateTrayOptions): TrayHandle {
  // Apply systray2's boot hygiene (chmod the binary, etc.) before
  // construction. Skip-precondition cases (headless / arm64) are the
  // caller's responsibility; if they didn't gate, we surface the
  // failure as a thrown error here.
  preflightTrayBinary();
  const skip = trayPreconditionSkip();
  if (skip) {
    throw new Error(`Tray cannot start: ${skip}`);
  }

  type SystrayMenuItem = { title: string; tooltip: string; checked: boolean; enabled: boolean };
  type SystrayCtor = new (config: {
    menu: { icon: string; title: string; tooltip: string; items: SystrayMenuItem[] };
    debug: boolean;
    copyDir: boolean;
  }) => SystrayInst;
  interface SystrayInst {
    ready(): Promise<void>;
    onClick(cb: (action: { item: SystrayMenuItem }) => void): Promise<void>;
    sendAction(action: unknown): Promise<void>;
    kill(graceful: boolean): void;
    separator: SystrayMenuItem;
  }
  type SystrayMod = { default: SystrayCtor & { separator: SystrayMenuItem } };

  let SysTray: SystrayCtor & { separator: SystrayMenuItem };
  try {
    SysTray = (_require("systray2") as SystrayMod).default;
  } catch (e) {
    throw new Error(
      `No tray backend available: native prebuilt not installed AND systray2 not loadable (${(e as Error).message}). ` +
      `Install @mailpouch/tray-native-<platform> or systray2 to enable the tray.`,
    );
  }

  // Map our generic items to systray2's shape. Track id↔title for the
  // click callback — systray2 dispatches by visible title, not by id.
  const titleToId = new Map<string, string>();
  const sysItems: SystrayMenuItem[] = opts.items.map((i) => {
    if (i.separator) return SysTray.separator;
    titleToId.set(i.label, i.id);
    return { title: i.label, tooltip: "", checked: false, enabled: i.enabled !== false };
  });

  const tray = new SysTray({
    menu: {
      icon: opts.iconPng.toString("base64"),
      title: "",
      tooltip: opts.tooltip,
      items: sysItems,
    },
    debug: false,
    copyDir: true,
  });

  tray.ready().then(() =>
    tray.onClick((action) => {
      const id = titleToId.get(action.item.title);
      if (id) opts.onClick(id);
    }),
  ).catch(() => { /* ignore — best-effort fallback */ });

  return {
    backend: "systray2",
    setMenu: (_items) => {
      // Best-effort no-op: systray2's `update-menu` is async and
      // the wrapper would need re-mapping; the rare case where this
      // matters (settings UI re-render) is acceptable to ignore on
      // the legacy backend. Native callers get a real implementation.
    },
    setIcon: (bytes) => {
      void tray.sendAction({ type: "update-menu", menu: { icon: bytes.toString("base64"), title: "", tooltip: opts.tooltip, items: sysItems } });
    },
    setTooltip: (s) => {
      void tray.sendAction({ type: "update-menu", menu: { icon: opts.iconPng.toString("base64"), title: "", tooltip: s, items: sysItems } });
    },
    destroy: () => { try { tray.kill(false); } catch { /* already gone */ } },
  };
}
