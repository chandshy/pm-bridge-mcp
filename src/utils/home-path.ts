import { homedir } from "os";
import nodePath from "path";

/**
 * Resolve a runtime data-file path under $HOME, with an optional env-var
 * override. CRED-002 (audit 2026-05-28): the override path is resolved
 * and required to stay within $HOME, mirroring `getConfigPath()`'s
 * containment check in src/config/loader.ts. Without this, env-driven
 * path traversal (e.g. `MAILPOUCH_PASS_AUDIT=../../etc/cron.d/foo`) would
 * redirect credential-bearing writes outside the home directory.
 *
 * Throws on a bad override path so callers fail loudly at startup rather
 * than silently writing into attacker-controlled locations.
 */
export function homeFile(envName: string, basename: string): string {
  const envPath = process.env[envName];
  if (envPath) {
    const resolved = nodePath.resolve(nodePath.normalize(envPath));
    const home = homedir();
    if (!resolved.startsWith(home + nodePath.sep) && resolved !== home) {
      throw new Error(
        `${envName} must point to a path within the home directory (${home}). Got: ${resolved}`
      );
    }
    return resolved;
  }
  return nodePath.join(homedir(), basename);
}
