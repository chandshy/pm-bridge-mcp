import { describe, it, expect, vi } from 'vitest';
import type { ServerConfig } from '../config/schema.js';

// keytar is an optional dependency that won't be installed in test environments.
// All functions should gracefully return null/false when keytar is unavailable.

describe('Keychain (without keytar installed)', () => {
  it('isKeychainAvailable should return false', async () => {
    const { isKeychainAvailable } = await import('./keychain.js');
    const available = await isKeychainAvailable();
    expect(available).toBe(false);
  });

  it('loadCredentials should return null', async () => {
    const { loadCredentials } = await import('./keychain.js');
    const creds = await loadCredentials();
    expect(creds).toBeNull();
  });

  it('saveCredentials should return false', async () => {
    const { saveCredentials } = await import('./keychain.js');
    const result = await saveCredentials('password', 'token');
    expect(result).toBe(false);
  });

  it('deleteCredentials should return false', async () => {
    const { deleteCredentials } = await import('./keychain.js');
    const result = await deleteCredentials();
    expect(result).toBe(false);
  });

  it('migrateFromConfig should return false when keychain unavailable', async () => {
    const { migrateFromConfig } = await import('./keychain.js');
    const mockConfig = {
      configVersion: 1,
      connection: {
        smtpHost: 'localhost',
        smtpPort: 1025,
        imapHost: 'localhost',
        imapPort: 1143,
        username: 'user@proton.me',
        password: 'bridge-password',
        smtpToken: '',
        bridgeCertPath: '',
        debug: false,
      },
      permissions: {
        preset: 'read_only' as const,
        tools: {} as any,
      },
    } satisfies ServerConfig;

    const saveFn = vi.fn();
    const result = await migrateFromConfig(mockConfig, saveFn);
    expect(result).toBe(false);
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('migrateFromConfig should return false when no credentials to migrate', async () => {
    const { migrateFromConfig } = await import('./keychain.js');
    const mockConfig = {
      configVersion: 1,
      connection: {
        smtpHost: 'localhost',
        smtpPort: 1025,
        imapHost: 'localhost',
        imapPort: 1143,
        username: 'user@proton.me',
        password: '',
        smtpToken: '',
        bridgeCertPath: '',
        debug: false,
      },
      permissions: {
        preset: 'read_only' as const,
        tools: {} as any,
      },
    } satisfies ServerConfig;

    const saveFn = vi.fn();
    const result = await migrateFromConfig(mockConfig, saveFn);
    expect(result).toBe(false);
    expect(saveFn).not.toHaveBeenCalled();
  });

  // ─── CRED-001 (audit 2026-05-28): aux credential migration ──────────────

  it('loadAuxiliaryCredentials should return null without keytar', async () => {
    const { loadAuxiliaryCredentials } = await import('./keychain.js');
    expect(await loadAuxiliaryCredentials()).toBeNull();
  });

  it('saveAuxiliaryCredentials should return false without keytar', async () => {
    const { saveAuxiliaryCredentials } = await import('./keychain.js');
    expect(await saveAuxiliaryCredentials('pat-secret', 'sl-key')).toBe(false);
  });

  it('migrateFromConfig with only Pass PAT set leaves the secret on disk when keychain is unavailable (CRED-001)', async () => {
    const { migrateFromConfig } = await import('./keychain.js');
    const mockConfig = {
      configVersion: 1,
      connection: {
        smtpHost: 'localhost',
        smtpPort: 1025,
        imapHost: 'localhost',
        imapPort: 1143,
        username: 'user@proton.me',
        password: '',
        smtpToken: '',
        passAccessToken: 'pat-secret-123',
        simpleloginApiKey: '',
        bridgeCertPath: '',
        debug: false,
      },
      permissions: {
        preset: 'read_only' as const,
        tools: {} as any,
      },
    } satisfies ServerConfig;

    const saveFn = vi.fn();
    // Without keychain, return is false and the secret stays on disk —
    // any successful keychain save would have blanked the field. This is
    // the behaviour-preserving guard for the new aux-credential plumbing:
    // we don't crash on the new fields, we don't lose them, and we don't
    // pretend they migrated when keychain is unavailable. The harder
    // assertion ("the migration code branched into the new aux block,
    // not into the legacy 'nothing to migrate' early return") needs a
    // keytar mock — TEST-005 in Batch 7 will add that positive-path harness.
    const result = await migrateFromConfig(mockConfig, saveFn);
    expect(result).toBe(false);
    expect(mockConfig.connection.passAccessToken).toBe('pat-secret-123');
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('migrateFromConfig with only SimpleLogin API key set leaves the secret on disk when keychain is unavailable (CRED-001)', async () => {
    const { migrateFromConfig } = await import('./keychain.js');
    const mockConfig = {
      configVersion: 1,
      connection: {
        smtpHost: 'localhost',
        smtpPort: 1025,
        imapHost: 'localhost',
        imapPort: 1143,
        username: 'user@proton.me',
        password: '',
        smtpToken: '',
        passAccessToken: '',
        simpleloginApiKey: 'sl-api-key-xyz',
        bridgeCertPath: '',
        debug: false,
      },
      permissions: {
        preset: 'read_only' as const,
        tools: {} as any,
      },
    } satisfies ServerConfig;

    const saveFn = vi.fn();
    const result = await migrateFromConfig(mockConfig, saveFn);
    expect(result).toBe(false);
    expect(mockConfig.connection.simpleloginApiKey).toBe('sl-api-key-xyz');
    expect(saveFn).not.toHaveBeenCalled();
  });
});
