/**
 * Per-agent permission gate.
 *
 * Consults the AgentGrantStore to decide whether a specific agent may call
 * a specific tool at this instant. Runs BEFORE the existing global-preset
 * check and BEFORE the destructive-confirmation gate, so denials are
 * cheap and conditional permissions are applied consistently.
 *
 * Design notes
 *  - The grant's preset is intersected with the global preset to produce
 *    the effective permissions. A grant can never widen what the global
 *    config allows.
 *  - Expiry is checked at call time. Crossing expiresAt transitions the
 *    grant to "expired" and logs the status change — the MCP client will
 *    get a 401-equivalent on its next call, which is the clearest signal.
 *  - Folder-allowlist + IP-pin checks are advisory here: the gate has
 *    enough context (tool name, args, caller IP) to enforce them, but the
 *    folder check is best-effort (only applied when the tool's args
 *    include a recognizable folder field). A malicious tool that tunnels
 *    folder intent through non-standard args would slip through — acceptable
 *    for v1; we can extend when real misuse patterns appear.
 */

import type { AgentGrant, GrantCheckResult, GrantConditions } from "./types.js";
import type { ToolName, PermissionPreset } from "../config/schema.js";
import { buildPermissions } from "../config/loader.js";
import type { AgentGrantStore } from "./grant-store.js";

export interface GrantCheckContext {
  clientId: string;
  tool: ToolName | string;
  args?: Record<string, unknown>;
  callerIp?: string;
  /** The global config preset — the upper bound for the grant. */
  globalPreset: PermissionPreset;
}

export class GrantManager {
  constructor(private readonly store: AgentGrantStore) {}

  /**
   * Core decision: allowed? Returns a structured result. Callers surface the
   * reason string to the MCP response so the agent can distinguish "not yet
   * approved" from "revoked" from "tool outside your scope".
   */
  check(ctx: GrantCheckContext): GrantCheckResult {
    const grant = this.store.get(ctx.clientId);
    if (!grant) {
      return { allowed: false, reason: `No grant registered for client ${ctx.clientId}. An MCP host is expected to DCR before calling tools.` };
    }

    switch (grant.status) {
      case "pending":
        return { allowed: false, reason: `Grant for '${grant.clientName}' is pending user approval. Open the settings UI to approve.` };
      case "revoked":
        return { allowed: false, reason: `Grant for '${grant.clientName}' was revoked at ${grant.revokedAt ?? "(unknown time)"}.` };
      case "expired":
        return { allowed: false, reason: `Grant for '${grant.clientName}' expired. Reapprove in the settings UI.` };
    }

    // Status is "active" — check conditions.
    const now = Date.now();
    if (grant.conditions?.expiresAt) {
      const expMs = Date.parse(grant.conditions.expiresAt);
      if (Number.isFinite(expMs) && expMs <= now) {
        this.store.markExpired(grant.clientId);
        return { allowed: false, reason: `Grant for '${grant.clientName}' expired.` };
      }
    }

    if (grant.conditions?.ipPins && grant.conditions.ipPins.length > 0) {
      if (!ctx.callerIp || !grant.conditions.ipPins.includes(ctx.callerIp)) {
        return { allowed: false, reason: `Grant for '${grant.clientName}' is IP-pinned; caller IP ${ctx.callerIp ?? "(unknown)"} is not in the allowlist.` };
      }
    }

    // Tool override always wins, in either direction.
    const override = grant.toolOverrides?.[ctx.tool as ToolName];
    if (override === false) {
      return { allowed: false, reason: `Tool '${ctx.tool}' is explicitly denied for '${grant.clientName}'.` };
    }
    if (override === true) {
      // Override opens the tool but it still needs to exist in the global preset.
      if (!this.globalAllows(ctx.globalPreset, ctx.tool)) {
        return { allowed: false, reason: `Tool '${ctx.tool}' is disabled by the global preset; per-agent override cannot widen the server's ceiling.` };
      }
      return this.checkFolderCondition(grant, ctx, grant.preset);
    }

    // No override — apply the intersection of grant preset and global preset.
    const effective = intersectPresets(grant.preset, ctx.globalPreset);
    if (!this.globalAllows(effective, ctx.tool)) {
      return { allowed: false, reason: `Tool '${ctx.tool}' is outside the effective preset '${effective}' for '${grant.clientName}'.` };
    }

    return this.checkFolderCondition(grant, ctx, effective);
  }

  private checkFolderCondition(grant: AgentGrant, ctx: GrantCheckContext, effective: PermissionPreset): GrantCheckResult {
    const allow = grant.conditions?.folderAllowlist;
    if (!allow || allow.length === 0) return { allowed: true, effectivePreset: effective };
    const folder = extractFolderArg(ctx.args);
    if (!folder) {
      // For folder-scoped tools, the absence of a recognized folder arg is
      // suspicious: an attacker could tunnel folder intent through a
      // non-standard arg name to escape the allowlist. Fail closed unless
      // the tool is explicitly known to be folder-agnostic.
      if (FOLDER_AGNOSTIC_TOOLS.has(ctx.tool)) return { allowed: true, effectivePreset: effective };
      return { allowed: false, reason: `Tool '${ctx.tool}' has no recognized folder argument; the grant's folder allowlist requires a folder.` };
    }
    const lower = folder.toLowerCase();
    if (!allow.some(a => a.toLowerCase() === lower)) {
      return { allowed: false, reason: `Folder '${folder}' is outside the grant's allowlist (${allow.join(", ")}).` };
    }
    return { allowed: true, effectivePreset: effective };
  }

  private globalAllows(preset: PermissionPreset, tool: string): boolean {
    // Memoize on preset — buildPermissions materializes a full map per call,
    // but the preset→permissions mapping is pure. `check()` can consult this
    // twice per call (once for the override path, once for the preset path),
    // and a high-QPS agent would materialize the same map over and over.
    let perms = this.permsCache.get(preset);
    if (!perms) {
      perms = buildPermissions(preset);
      this.permsCache.set(preset, perms);
    }
    return !!perms.tools[tool as ToolName]?.enabled;
  }

  private readonly permsCache = new Map<PermissionPreset, ReturnType<typeof buildPermissions>>();
}

/**
 * Pull a folder argument out of a tool call's args. Recognizes the
 * conventional field names used across the existing tool surface: `folder`,
 * `mailbox`, `targetFolder`. Returns undefined when no folder-like field
 * is present.
 */
function extractFolderArg(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const k of ["folder", "mailbox", "targetFolder", "folderName", "target_folder"]) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Tools that legitimately operate without a folder argument and therefore
 *  should NOT trigger the fail-closed folder-allowlist check. Stats /
 *  analytics / contacts roll up across all folders by design; system /
 *  config / FTS-index management is folder-agnostic. */
const FOLDER_AGNOSTIC_TOOLS = new Set<string>([
  "get_email_stats", "get_email_analytics", "get_volume_trends",
  "get_contacts", "get_correspondence_profile",
  "list_labels", "get_folders", "sync_folders",
  "get_connection_status", "get_unread_count", "get_email_stats",
  "clear_cache", "get_logs", "start_bridge", "shutdown_server", "restart_server",
  "fts_search", "fts_rebuild", "fts_status",
  "list_scheduled_emails", "list_proton_scheduled", "cancel_scheduled_email",
  "list_pending_reminders", "cancel_reminder", "check_reminders",
  "remind_if_no_reply",
  "alias_list", "alias_create_random", "alias_create_custom",
  "alias_toggle", "alias_delete", "alias_get_activity",
  "pass_list", "pass_search", "pass_get",
  "extract_action_items", "extract_meeting",
  "send_email", "send_test_email", "reply_to_email", "forward_email",
  "save_draft", "schedule_email",
  "request_permission_escalation", "check_escalation_status",
  "sync_emails",
  // Email-ID-scoped tools — folder is implied by the message UID, not by an arg.
  "get_email_by_id", "get_thread", "mark_email_read", "star_email",
  "delete_email", "download_attachment",
]);

/**
 * Intersect two presets — return the stricter of the two. Ordering is
 * read_only < send_only < supervised < full; custom sorts with full (the
 * caller has already opted into whatever the custom set allows).
 */
function intersectPresets(a: PermissionPreset, b: PermissionPreset): PermissionPreset {
  const rank: Record<PermissionPreset, number> = {
    read_only: 0,
    send_only: 1,
    supervised: 2,
    full: 3,
    custom: 3,
  };
  return rank[a] <= rank[b] ? a : b;
}
