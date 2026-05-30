/**
 * Minimal cross-process advisory lock (PERM-006).
 *
 * The grant store and the escalation pending-file are mutated by BOTH the
 * MCP server and the settings server via a load → mutate → atomic-rename
 * cycle. The atomic rename prevents torn reads, but does NOT prevent a
 * lost-update race: two processes can each `load`, each mutate their own
 * copy, and the second `rename` clobbers the first writer's record.
 *
 * This helper serializes those cycles with a sibling `${target}.lock`
 * directory. We use `mkdirSync` (not an `O_EXCL` file open) because directory
 * creation is atomic on every platform and leaves no ambiguity about whether
 * the lock was acquired. A stale lock (holder crashed mid-cycle) is broken
 * once it is older than STALE_MS so the system can never deadlock.
 *
 * No external dependency — `proper-lockfile`/`flock` would be heavier than the
 * guarantee we need here (single-host, two cooperating Node processes, sub-ms
 * critical sections).
 */

import { mkdirSync, rmdirSync, statSync } from "fs";
import { logger } from "./logger.js";

/** Lock considered abandoned after this long — the holder almost certainly crashed. */
const STALE_MS = 10_000;
/** Poll interval while spinning for the lock. */
const SPIN_MS = 15;
/** Give up acquiring after this long and proceed unlocked (best-effort, never deadlock). */
const ACQUIRE_TIMEOUT_MS = 5_000;

function lockPath(target: string): string {
  return `${target}.lock`;
}

/** Best-effort blocking acquire. Returns true if the lock dir is now held by us. */
function acquire(dir: string): boolean {
  // Compute the deadline lazily so the uncontended fast path (first mkdir
  // succeeds) consumes NO Date.now() — keeps callers that mock Date.now for
  // their own TOCTOU assertions deterministic.
  let deadline = 0;
  for (;;) {
    try {
      mkdirSync(dir);
      return true;
    } catch {
      if (deadline === 0) deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
      // Held by someone else (or a leftover from a crash). Break it if stale.
      try {
        const age = Date.now() - statSync(dir).mtimeMs;
        if (age > STALE_MS) {
          try { rmdirSync(dir); } catch { /* another process won the break — retry */ }
          continue;
        }
      } catch {
        // The lock dir vanished between mkdir and stat — retry immediately.
        continue;
      }
      if (Date.now() >= deadline) return false;
      // Busy-wait briefly. The critical sections are sub-millisecond JSON
      // load/save cycles, so a short synchronous spin is acceptable and keeps
      // the API synchronous (these stores are used from sync code paths).
      const until = Date.now() + SPIN_MS;
      while (Date.now() < until) { /* spin */ }
    }
  }
}

function release(dir: string): void {
  try { rmdirSync(dir); } catch { /* already gone — nothing to do */ }
}

/**
 * Run `fn` while holding a cross-process advisory lock on `target`. The lock is
 * always released, even if `fn` throws. If the lock cannot be acquired within
 * the timeout, `fn` still runs (best-effort) — we prefer a rare lost update to
 * a hung server.
 */
export function withFileLock<T>(target: string, fn: () => T): T {
  const dir = lockPath(target);
  const held = acquire(dir);
  if (!held) {
    logger.warn(`withFileLock: timed out acquiring ${dir}; proceeding unlocked`, "FileLock");
  }
  try {
    return fn();
  } finally {
    if (held) release(dir);
  }
}
