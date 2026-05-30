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

    // PERM-013: a "custom" grant has no meaningful preset map of its own —
    // buildPermissions("custom") enables every tool, identical to "full". The
    // user's intent for a custom grant lives entirely in `toolOverrides`,
    // which were already applied above. With no override the tool is NOT in
    // the custom surface, so it must default-deny here. The old rank table
    // ranked custom == full (3); intersecting custom with a lower global
    // preset returned the GLOBAL preset and then consulted its enabled-map,
    // silently re-enabling tools the user had disabled in the custom set.
    if (grant.preset === "custom") {
      return { allowed: false, reason: `Tool '${ctx.tool}' is not in the custom grant surface for '${grant.clientName}' (custom grants allow only explicitly-overridden tools).` };
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

  /**
   * Resolve the effective folder allowlist for a caller. Used by tools that
   * return folder-bearing content (e.g., FTS snippets) and need to filter
   * results to the caller's allowed folders independently of the per-call
   * `folder` arg check in {@link check}.
   *
   * Returns:
   *  - `undefined` when there is no grant, the grant has no folder restriction,
   *    or the grant's allowlist is an empty array. Caller should treat
   *    `undefined` as "no restriction — return all folders" to preserve
   *    existing behavior for unscoped grants and stdio/local callers.
   *  - A non-empty `string[]` when the grant's `conditions.folderAllowlist`
   *    is set to a non-empty list. Caller should restrict results to those
   *    folders.
   *
   * Note: this method intentionally does not return `[]` to distinguish
   * "no grant / no restriction" from "explicitly empty allowlist". The
   * grant schema treats an empty allowlist the same as no allowlist; if
   * future revisions tighten that semantic, callers can switch on the
   * returned value's length.
   */
  resolveAllowedFolders(clientId: string): string[] | undefined {
    const grant = this.store.get(clientId);
    const allow = grant?.conditions?.folderAllowlist;
    if (!allow || allow.length === 0) return undefined;
    return [...allow];
  }
}

/**
 * Pull a folder argument out of a tool call's args. Recognizes the
 * conventional field names used across the existing tool surface: `folder`,
 * `mailbox`, `targetFolder`, and (PERM-011) `sourceFolder` — the field that
 * carries the originating folder for email-ID-scoped mutators since v3.0.41.
 * Returns undefined when no folder-like field is present.
 */
function extractFolderArg(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  for (const k of ["folder", "mailbox", "targetFolder", "folderName", "target_folder", "sourceFolder", "source_folder"]) {
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
  // PERM-011: email-ID-scoped mutators (delete_email, mark_email_read,
  // star_email, get_email_by_id) used to be folder-agnostic on the theory that
  // "the folder is implied by the UID". But UIDs ARE folder-scoped, and since
  // v3.0.41 these tools carry+honor the originating folder in `sourceFolder`
  // (get_email_by_id honors `folder`). Leaving them agnostic let a grant pinned
  // to INBOX act on a UID in Archive via `{ sourceFolder: "Archive" }`. They are
  // now enforced by the allowlist via extractFolderArg; a call that omits the
  // folder fails closed (consistent with checkFolderCondition).
  //
  // get_thread and download_attachment are DELIBERATELY still agnostic here:
  // gating them at this layer would be false enforcement, not real. get_thread
  // takes a seed folder but then assembles related messages from INBOX+Sent
  // unconditionally (src/tools/reading.ts), so a seed-folder check passes while
  // results still come from outside the allowlist. download_attachment passes
  // no folder to imapService.downloadAttachment at all, so the gate has nothing
  // truthful to check and would simply fail-closed for every restricted grant.
  // Both need service-level folder constraints (cross-folder thread assembly;
  // attachment UID resolution) to be honestly scoped — tracked as a PERM-011
  // residual; see the audit annotation.
  "get_thread", "download_attachment",
]);

/**
 * Intersect two presets — return the stricter of the two. Ordering is
 * read_only < send_only < supervised < full.
 *
 * PERM-013: `a` (the grant preset) is never "custom" here — check() short-
 * circuits a custom grant to its explicit toolOverrides before reaching this
 * function, because buildPermissions("custom") is all-enabled and carries no
 * real restriction. `b` (the global preset) may still be "custom"; it sorts at
 * the top of the rank (most permissive preset-level ceiling), and the live
 * per-tool custom config is enforced separately by the global permission gate
 * (PermissionManager.check), so a custom global cannot silently widen a grant.
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
