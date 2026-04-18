/**
 * OS keychain abstraction for credential storage.
 *
 * Uses `@napi-rs/keyring` (optional dependency) to store credentials in:
 * - Windows: Credential Manager (pre-built binaries, no compilation needed)
 * - macOS: Keychain
 * - Linux: libsecret / GNOME Keyring
 *
 * If @napi-rs/keyring is not installed or the OS keychain is unavailable
 * (headless server, no GUI), all functions gracefully return null/false and
 * the caller falls back to config-file storage.
 */

import type { ServerConfig } from "../config/schema.js";
import { logger } from "../utils/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_NAME = "mail-ai-bridge";
/**
 * Legacy service names probed at startup for one-shot migration into the
 * new `mail-ai-bridge` service namespace. Listed newest-legacy first so a
 * half-migrated install (`pm-bridge-mcp` exists but `protonmail-mcp-server`
 * doesn't) is picked up before the older name.
 */
const LEGACY_SERVICE_NAMES = ["pm-bridge-mcp", "protonmail-mcp-server"] as const;
const KEY_PASSWORD = "bridge-password";
const KEY_SMTP_TOKEN = "smtp-token";
/** All account keys known to live under the service — iterated by the migration pass. */
const MIGRATED_ACCOUNT_KEYS = [KEY_PASSWORD, KEY_SMTP_TOKEN] as const;

// ─── Lazy @napi-rs/keyring loading ────────────────────────────────────────────

interface EntryClass {
  new (service: string, account: string): {
    getPassword(): string | null;
    setPassword(password: string): void;
    deletePassword(): boolean;
  };
}

interface KeyringModule {
  Entry: EntryClass;
}

let keyringModule: KeyringModule | null = null;
let keyringChecked = false;

async function getKeyring(): Promise<KeyringModule | null> {
  if (keyringChecked) return keyringModule;
  keyringChecked = true;
  try {
    // Dynamic import — @napi-rs/keyring is an optional dependency and may not
    // be installed. Using Function constructor to bypass TypeScript's static
    // module resolution.
    const importFn = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;
    keyringModule = await importFn("@napi-rs/keyring") as KeyringModule;
    return keyringModule;
  } catch {
    keyringModule = null;
    return null;
  }
}

/**
 * Test-only reset. Clears the cached @napi-rs/keyring module so the next call
 * re-runs `getKeyring()`. Exported for unit tests that vi.mock('@napi-rs/keyring')
 * differently across cases; no production caller should invoke it.
 */
export function _resetKeyringCacheForTests(): void {
  keyringModule = null;
  keyringChecked = false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if the OS keychain is available.
 * Returns false if @napi-rs/keyring is not installed or the keychain daemon
 * is not running.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  try {
    const keyring = await getKeyring();
    if (!keyring) return false;
    // Probe call — will throw if no keychain daemon is running
    const probe = new keyring.Entry(SERVICE_NAME, "__probe__");
    probe.getPassword();
    return true;
  } catch {
    return false;
  }
}

/**
 * Load credentials from the OS keychain.
 * Returns null if keychain is unavailable or credentials are not stored.
 */
export async function loadCredentials(): Promise<{ password: string; smtpToken: string } | null> {
  try {
    const keyring = await getKeyring();
    if (!keyring) return null;

    const password = new keyring.Entry(SERVICE_NAME, KEY_PASSWORD).getPassword() ?? "";
    const smtpToken = new keyring.Entry(SERVICE_NAME, KEY_SMTP_TOKEN).getPassword() ?? "";

    if (!password && !smtpToken) return null;
    return { password, smtpToken };
  } catch {
    return null;
  }
}

/**
 * Save credentials to the OS keychain.
 * Returns true on success, false if keychain is unavailable.
 */
export async function saveCredentials(password: string, smtpToken: string): Promise<boolean> {
  try {
    const keyring = await getKeyring();
    if (!keyring) return false;

    if (password) {
      new keyring.Entry(SERVICE_NAME, KEY_PASSWORD).setPassword(password);
    }
    if (smtpToken) {
      new keyring.Entry(SERVICE_NAME, KEY_SMTP_TOKEN).setPassword(smtpToken);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete credentials from the OS keychain.
 * Returns true on success, false if keychain is unavailable.
 */
export async function deleteCredentials(): Promise<boolean> {
  try {
    const keyring = await getKeyring();
    if (!keyring) return false;

    new keyring.Entry(SERVICE_NAME, KEY_PASSWORD).deletePassword();
    new keyring.Entry(SERVICE_NAME, KEY_SMTP_TOKEN).deletePassword();
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate plaintext credentials from config file to OS keychain.
 * Idempotent — safe to call multiple times.
 *
 * Returns true if migration occurred, false if skipped or failed.
 */
export async function migrateFromConfig(
  config: ServerConfig,
  saveConfigFn: (config: ServerConfig) => void,
): Promise<boolean> {
  const password = config.connection.password;
  const smtpToken = config.connection.smtpToken;

  // Nothing to migrate if credentials are already blank
  if (!password && !smtpToken) return false;

  // Check if keychain is available
  const available = await isKeychainAvailable();
  if (!available) return false;

  // Store in keychain
  const saved = await saveCredentials(password, smtpToken);
  if (!saved) return false;

  // Blank credentials in config file
  config.connection.password = "";
  config.connection.smtpToken = "";
  config.credentialStorage = "keychain";
  saveConfigFn(config);

  return true;
}

// ─── Legacy service-name migration ────────────────────────────────────────────

export interface LegacyMigrationResult {
  /** Count of entries moved into the new service namespace. */
  migrated: number;
  /** Legacy entries skipped because a value already exists under the new name. */
  conflicts: number;
}

/**
 * One-shot migration from legacy `protonmail-mcp-server` / `pm-bridge-mcp`
 * service names to the current `mail-ai-bridge` service. Runs at server boot.
 *
 * For each legacy service name, for each account key: read the legacy value;
 * if present and the new entry is empty, copy it over; then delete the legacy
 * entry regardless (so we don't re-migrate on the next boot and to keep the
 * OS-level secret surface from lingering under a dead identity).
 *
 * Failures are non-fatal — a stranded credential just means the user will be
 * re-prompted, which is strictly better than crashing the server.
 */
export async function migrateLegacyKeychainEntries(): Promise<LegacyMigrationResult> {
  let migrated = 0;
  let conflicts = 0;

  try {
    const keyring = await getKeyring();
    if (!keyring) return { migrated, conflicts };

    for (const legacyService of LEGACY_SERVICE_NAMES) {
      for (const account of MIGRATED_ACCOUNT_KEYS) {
        try {
          const legacyEntry = new keyring.Entry(legacyService, account);
          const legacyValue = legacyEntry.getPassword();
          if (!legacyValue) continue;

          const newEntry = new keyring.Entry(SERVICE_NAME, account);
          const existing = newEntry.getPassword();
          if (existing) {
            // Don't clobber a newer value; still clear the legacy copy so
            // OS-level credential lists don't show two conflicting entries.
            conflicts++;
            try { legacyEntry.deletePassword(); } catch { /* best-effort */ }
            continue;
          }

          newEntry.setPassword(legacyValue);
          try { legacyEntry.deletePassword(); } catch { /* best-effort */ }
          migrated++;
          logger.info(
            `Keychain: migrated ${account} from '${legacyService}' to '${SERVICE_NAME}'`,
            "Keychain",
          );
        } catch (err) {
          // Non-fatal per account — keep scanning the rest.
          logger.debug(
            `Keychain: migration probe failed for ${legacyService}/${account}`,
            "Keychain",
            err,
          );
        }
      }
    }
  } catch (err) {
    logger.debug("Keychain: legacy migration aborted (keyring unavailable)", "Keychain", err);
  }

  return { migrated, conflicts };
}
