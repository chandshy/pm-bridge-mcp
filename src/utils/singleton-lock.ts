/**
 * Per-account instance singleton guard (Cluster 2, 2026-05-31 report).
 *
 * Multiple `claude --continue` sessions each spawn a mailpouch MCP, and each
 * one runs its own IMAP IDLE/auth loop against the SAME mailbox — a compounded
 * connection leak. This guard lets the FIRST live instance for an account hold
 * a PID lock file under $HOME; a later instance that finds a *live* holder
 * exits cleanly (the caller logs and `process.exit(0)`s) instead of opening a
 * second IMAP connection.
 *
 * Design notes:
 *  - The lock is a plain file containing the holder's PID (decimal). We write
 *    it with `wx` (O_EXCL) so creation is atomic — only one process can win.
 *  - A *stale* lock (holder crashed without releasing) is reclaimed: if the
 *    recorded PID is not a live process, we delete the file and retry once.
 *    This is what allows a legitimate restart after a clean OR crashed shutdown
 *    to proceed — we never block on a dead PID.
 *  - Fail-safe: any unexpected error in the mechanism itself resolves to
 *    `acquired` so a broken lock can never block a legitimate start.
 *
 * No external dependency and no new runtime deps — `fs` + `process.kill(pid, 0)`
 * is sufficient for the single-host, cooperating-Node-process case.
 */

import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { homeFile } from "./home-path.js";

export type LockOutcome =
  | { status: "acquired"; path: string; reclaimed: boolean }
  | { status: "held-by-live-instance"; path: string; pid: number };

/**
 * Derive the per-account lock file path. The account identity (typically the
 * username/email) is hashed so the filename never leaks the address and stays
 * filesystem-safe. Empty/undefined identity collapses to a stable "default"
 * bucket so a not-yet-configured install still gets a singleton guard.
 */
export function lockPathForAccount(accountIdentity: string | undefined | null): string {
  const id = (accountIdentity ?? "").trim().toLowerCase() || "default";
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 16);
  // Env override resolved + $HOME-contained by homeFile (CRED-002).
  return homeFile("MAILPOUCH_LOCK_PATH", `.mailpouch-${hash}.lock`);
}

/** True if `pid` is a live process this user can signal. */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs error checking without sending a signal.
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // EPERM means the process exists but is owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Attempt to acquire the singleton lock for `accountIdentity`.
 *
 * Returns `held-by-live-instance` when another live mailpouch already owns it
 * (caller should log + exit 0). Returns `acquired` when we now own the lock —
 * `reclaimed` is true if we broke a stale (dead-PID) lock to do so.
 *
 * Fail-safe: on any unexpected error, resolves to `acquired` so the start is
 * never blocked by a malfunctioning lock.
 *
 * @param pid the PID to record as the holder (defaults to this process).
 */
export function acquireSingletonLock(
  accountIdentity: string | undefined | null,
  pid: number = process.pid,
): LockOutcome {
  const path = lockPathForAccount(accountIdentity);
  // Two passes at most: first attempt, then one retry after reclaiming a stale
  // lock. A second EEXIST after reclaim means another process won the race —
  // treat it as a live holder rather than spinning.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(pid), { flag: "wx", mode: 0o600 });
      return { status: "acquired", path, reclaimed: attempt > 0 };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        // Unexpected FS error — fail safe: let the instance start.
        return { status: "acquired", path, reclaimed: false };
      }
    }

    // The lock exists. Read the holder PID and decide live vs stale.
    let holderPid = NaN;
    try {
      holderPid = parseInt(readFileSync(path, "utf8").trim(), 10);
    } catch {
      // Vanished between EEXIST and read — retry the create.
      continue;
    }

    if (isPidAlive(holderPid) && holderPid !== pid) {
      return { status: "held-by-live-instance", path, pid: holderPid };
    }

    // Stale (dead PID) or our own PID — reclaim and retry the create once.
    try { unlinkSync(path); } catch { /* another process won the break — retry */ }
  }

  // Lost the reclaim race to another starting instance: it now holds the lock.
  let holderPid = NaN;
  try { holderPid = parseInt(readFileSync(path, "utf8").trim(), 10); } catch { /* gone */ }
  if (isPidAlive(holderPid) && holderPid !== pid) {
    return { status: "held-by-live-instance", path, pid: holderPid };
  }
  // Couldn't confirm a live holder — fail safe and start.
  return { status: "acquired", path, reclaimed: true };
}

/**
 * Release a previously-acquired lock. Only removes the file if it still records
 * OUR pid, so we never delete a lock another instance legitimately re-took
 * after we (e.g.) were considered stale. Best-effort; never throws.
 */
export function releaseSingletonLock(path: string, pid: number = process.pid): void {
  try {
    const holderPid = parseInt(readFileSync(path, "utf8").trim(), 10);
    if (holderPid === pid) unlinkSync(path);
  } catch { /* already gone or unreadable — nothing to do */ }
}
