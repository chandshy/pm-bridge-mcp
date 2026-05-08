/**
 * Permission Manager — enforces per-tool access control and rate limiting.
 *
 * Reads the config file every CONFIG_CACHE_MS (default 15 s) so changes
 * made via the settings UI take effect without restarting the MCP server.
 *
 * Rate limiting uses an in-memory rolling 1-hour window.
 * If no config file exists the read-only preset is enforced (safe default).
 */

import { loadConfig, defaultConfig } from "../config/loader.js";
import { DEFAULT_RESPONSE_LIMITS, type RateLimitWindow, type ToolName, type ResponseLimits } from "../config/schema.js";
import { logger } from "../utils/logger.js";
import { tracer } from "../utils/tracer.js";

interface RateBucket {
  /** Timestamps (ms) of calls within the current rolling window */
  timestamps: number[];
}

export interface PermissionResult {
  allowed: boolean;
  /** Human-readable reason, present only when allowed === false */
  reason?: string;
}

const CONFIG_CACHE_MS = 15_000;

function windowMs_for(window: RateLimitWindow): number {
  if (window === 'second') return 1_000;
  if (window === 'minute') return 60_000;
  if (window === 'day')    return 86_400_000;
  return 3_600_000; // hour
}

export class PermissionManager {
  private rateBuckets = new Map<string, RateBucket>();
  private cachedConfig = loadConfig();
  private lastConfigLoad = Date.now();

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check whether a tool may be called right now.
   *
   * When no config file exists the read-only preset is enforced — agents may
   * read, search, and view analytics, but cannot send, move, delete, tag, or
   * modify any email state. Users must explicitly grant broader access via
   * the settings UI (`npm run settings`) and save a config file.
   */
  check(tool: ToolName): PermissionResult {
    const resultTags: { tool: string; allowed?: boolean; reason?: string } = { tool };
    return tracer.spanSync('permission.check', resultTags, () => {
    this.refreshConfigIfStale();

    // Fall back to read-only defaults when no config file is present.
    const config = this.cachedConfig ?? defaultConfig();

    const perm = config.permissions?.tools?.[tool];
    if (!perm) {
      resultTags.allowed = true;
      resultTags.reason = '';
      return { allowed: true };
    }

    if (!perm.enabled) {
      const reason = `'${tool}' is disabled in server settings. Enable it in the settings UI to allow agentic access.`;
      resultTags.allowed = false;
      resultTags.reason = reason;
      return { allowed: false, reason };
    }

    const limit = perm.rateLimit;
    if (limit !== null && limit !== undefined && limit > 0) {
      const window: RateLimitWindow = perm.rateLimitWindow ?? 'hour';
      if (!this.consumeRateSlot(tool, limit, window)) {
        logger.warn(`Rate limit reached for tool '${tool}' (limit: ${limit}/${window})`, "PermissionManager");
        const reason = `'${tool}' rate limit of ${limit} calls/${window} has been reached. Try again later or raise the limit in settings.`;
        resultTags.allowed = false;
        resultTags.reason = reason;
        return { allowed: false, reason };
      }
    }

    resultTags.allowed = true;
    resultTags.reason = '';
    return { allowed: true };
    }); // end tracer.spanSync('permission.check')
  }

  /**
   * Return current call counts for each rate-limited tool (for the status UI).
   */
  rateLimitStatus(): Record<string, { used: number; limit: number; window: RateLimitWindow }> {
    return tracer.spanSync('permission.rateLimitStatus', {}, () => {
    this.refreshConfigIfStale();
    const config = this.cachedConfig;
    if (!config) return {};

    const now = Date.now();
    const out: Record<string, { used: number; limit: number; window: RateLimitWindow }> = {};

    for (const [tool, perm] of Object.entries(config.permissions?.tools ?? {})) {
      if (perm.rateLimit !== null && perm.rateLimit !== undefined) {
        const window: RateLimitWindow = perm.rateLimitWindow ?? 'hour';
        const windowMs = windowMs_for(window);
        const bucket = this.rateBuckets.get(tool);
        const used = bucket
          ? bucket.timestamps.filter((ts) => ts > now - windowMs).length
          : 0;
        out[tool] = { used, limit: perm.rateLimit, window };
      }
    }
    return out;
    }); // end tracer.spanSync('permission.rateLimitStatus')
  }

  /** Return current response-size limits (hot-reloaded via 15 s config cache). */
  getResponseLimits(): ResponseLimits {
    this.refreshConfigIfStale();
    const config = this.cachedConfig ?? defaultConfig();
    return config.responseLimits ?? DEFAULT_RESPONSE_LIMITS;
  }

  /** Force an immediate config reload (e.g., after the settings UI saves). */
  invalidate(): void {
    this.cachedConfig = loadConfig();
    this.lastConfigLoad = Date.now();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private refreshConfigIfStale(): void {
    if (Date.now() - this.lastConfigLoad > CONFIG_CACHE_MS) {
      this.cachedConfig = loadConfig();
      this.lastConfigLoad = Date.now();
    }
  }

  private consumeRateSlot(tool: string, limit: number, window: RateLimitWindow): boolean {
    const now = Date.now();
    const windowStart = now - windowMs_for(window);

    let bucket = this.rateBuckets.get(tool);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.rateBuckets.set(tool, bucket);
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);

    if (bucket.timestamps.length >= limit) return false;

    bucket.timestamps.push(now);
    return true;
  }
}

/** Singleton shared across the MCP server process */
export const permissions = new PermissionManager();
