# TODO Improvements — Prioritized Backlog

Last updated: Cycle #20 (2026-03-18) — FINAL AUDIT CYCLE — ALL CYCLES COMPLETE
NOTE: Cycle #19 was the last code-change cycle. Cycle #20 is the final summary/audit report. No further cycles planned.

---

## HIGH PRIORITY

### [DONE - Cycle 1] Path traversal in label/folder handlers
Fixed in `get_emails_by_label`, `move_to_folder`, `remove_label`, `bulk_remove_label`.

---

## MEDIUM PRIORITY

### [DONE - Cycle 2] Add test coverage for new input validation
Extracted `validateLabelName`, `validateFolderName`, `validateTargetFolder` to `src/utils/helpers.ts`.
Added 27 tests in `helpers.test.ts` covering all branches. Refactored 4 handlers to use helpers.

### [DONE - Cycle 2] `SchedulerService` — items array unbounded growth
`pruneHistory()` method added. Called from `load()`. Drops non-pending records >30 days old, caps at 1000 records. 2 new tests added.

### [DONE - Cycle 2] `Analytics.getEmailStats()` — spread on large array
`Math.min/max(...dates)` replaced with `reduce` pattern in `analytics-service.ts`.

---

## LOW PRIORITY

### [DONE - Cycle 2] Fix comment numbering in graceful shutdown
Second "// 3." corrected to "// 4." in `src/index.ts`.

### [DONE - Cycle 2] `list_labels` detection logic cleanup
Removed redundant `|| f.name?.startsWith("Labels/")` condition.

### [DONE - Cycle 3] `move_email` / `bulk_move_emails` — missing targetFolder validation
Added `validateTargetFolder()` call before `imapService.moveEmail()` in both handlers.
Returns `McpError(InvalidParams)` for `..`, control chars, or oversized strings.

### [DONE - Cycle 3] `send_test_email` validation — friendly error
Added `isValidEmail(args.to)` check at handler entry. Returns `McpError(InvalidParams)`.

### [DONE - Cycle 3] `parseEmails` — silent dropping of invalid addresses
Imported `logger` into helpers.ts. `parseEmails` now calls `logger.warn(...)` for each dropped address.

### [DONE - Cycle 4] `send_test_email` body uses emoji in HTML
Fixed in `src/services/smtp-service.ts`. Subject and body now use plain ASCII text only.

### [DONE - Cycle 4] Add handler-level validation tests for Cycle #3 changes
Added 16 tests in `src/utils/helpers.test.ts` covering `move_email`, `bulk_move_emails`, and `send_test_email` validation paths (traversal, control chars, invalid email, oversized inputs, valid cases).

---

## NEW — Cycle #4 Findings (all completed in Cycle #5)

### [DONE - Cycle 5] `decodeCursor` folder field not validated against traversal
Fixed in `src/index.ts` `decodeCursor()`. Added `validateTargetFolder(parsed.folder) !== null` check before returning cursor. Crafted cursors with traversal paths (e.g. `../../etc`) now return null and are rejected as "Invalid or expired cursor".

### [DONE - Cycle 5] `get_email_by_id` / `download_attachment` — no handler-level type check on emailId/attachmentIndex
Fixed in `src/index.ts`. Added `!/^\d+$/.test(rawEmailId)` guard in `get_email_by_id`. Added numeric UID guard + `!Number.isInteger(rawAttIdx) || rawAttIdx < 0` guard in `download_attachment`. Both return `McpError(InvalidParams)` with clear messages.

---

## NEW — Cycle #5 Findings (all completed in Cycle #6)

### [DONE - Cycle 6] Add tests for Cycle #5 handler-level guards
Added 29 unit tests in `src/utils/helpers.test.ts` covering all branches of the three Cycle #5 guards: `decodeCursor` folder-validation (8 tests), `get_email_by_id` numeric UID guard (10 tests), and `download_attachment` email_id + attachment_index guards (11 tests).

### [DONE - Cycle 6] `search_emails` free-text fields — max-length guard
Added `MAX_SEARCH_TEXT = 500` and three inline checks in the `search_emails` handler in `src/index.ts`. Returns `McpError(InvalidParams)` for `from`/`to`/`subject` exceeding 500 characters.

---

## NEW — Cycle #6 Findings (all completed in Cycle #7)

### [DONE - Cycle 7] `create_folder` / `rename_folder` / `delete_folder` args — validateFolderName check
Added `validateFolderName()` call at handler entry for `create_folder`, `delete_folder` (folderName), and `rename_folder` (oldName and newName). All return `McpError(InvalidParams)` with clear messages for empty, slash, traversal, control-char, or oversized inputs.

### [DONE - Cycle 7] `mark_email_read` / `star_email` — missing numeric emailId guard
Added `!/^\d+$/.test(emailId)` guard to both handlers matching the pattern established in `get_email_by_id` (Cycle #5). Returns `McpError(InvalidParams, "emailId must be a non-empty numeric UID string.")` for invalid inputs.

---

## NEW — Cycle #7 Findings (all completed in Cycle #8)

### [DONE - Cycle 8] Remaining `args.X as Y` casts — type-check audit
Systematic audit performed. All `args.emailId as string` casts now have handler-level numeric UID guards. Bulk operation array items now filtered to `/^\d+$/.test(id)`. `get_emails` folder validated with `validateTargetFolder()`. See Cycle #8 work log for full details.

### 14. `save_draft` / `schedule_email` attachment validation
**File:** `src/index.ts`, `src/services/simple-imap-service.ts`
**Issue:** `args.attachments as any` is passed to `imapService.saveDraft()`. Attachment objects (name, contentType, content) are not validated at handler level. The service's `saveDraft` uses the contentType directly in MIME construction.
**Effort:** LOW–MEDIUM
**Risk:** LOW (content is base64-encoded; contentType is used as a MIME field and already handled by nodemailer/imapflow encoding)

---

## NEW — Cycle #8 Findings (all completed in Cycle #9)

### [DONE - Cycle 9] `move_to_label` / `remove_label` — missing numeric emailId guard
Added `!/^\d+$/.test(emailId)` guard to both handlers. `mtlEmailId` and `rlEmailId` local variables introduced (consistent naming). Returns `McpError(InvalidParams, "emailId must be a non-empty numeric UID string.")`.

### [DONE - Cycle 9] `save_draft` attachment validation — filename/contentType sanitization gap
`saveDraft` in `simple-imap-service.ts` now strips CRLF/NUL from `filename` (truncates to 255 chars, falls back to "attachment"), and validates `contentType` against type/subtype regex (falls back to undefined if invalid). Mirrors the robust sanitization already present in `smtp-service.ts sendEmail()`.

---

## NEW — Cycle #9 Findings (all completed in Cycle #10)

### [DONE - Cycle 10] Code quality — unused imports / dead code scan
No unused imports found. All imports in `src/index.ts` are referenced. `EmailAttachment` added to the import line as part of narrowing `as any` casts.

### [DONE - Cycle 10] Type safety — remaining `as any` casts in production code
9 avoidable `as any` casts removed across `src/index.ts`, `analytics-service.ts`, and `simple-imap-service.ts`. 2 unavoidable casts remain: `(result as any).uid` (imapflow type gap), `(att as any).content = undefined` (type omits undefined). See Cycle #10 log for full details.

### JSDoc coverage — public methods in service files
Partially addressed: `truncate()` in `helpers.ts` received expanded JSDoc. `SimpleIMAPService` and `SmtpService` public methods still largely undocumented. Deferred to Cycle #11.

---

## NEW — Cycle #10 Findings (all completed in Cycle #11)

### [DONE - Cycle 11] `(result as any).uid` in `simple-imap-service.ts` saveDraft
Added local `interface AppendResult { uid?: number }` before the class definition. Cast narrowed from `as any` to `as AppendResult`. Zero remaining `as any` casts for this access path.

### [DONE - Cycle 11] `(att as any).content = undefined` in `simple-imap-service.ts` wipeCache
`EmailAttachment.content` was already `content?: Buffer | string` (optional). The cast was spurious. Replaced with direct `att.content = undefined`.

### [DONE - Cycle 11] JSDoc coverage — SimpleIMAPService and SmtpService public methods
14 public methods now documented: `connect`, `disconnect`, `isActive`, `getFolders`, `getEmails`, `getEmailById`, `searchEmails`, `markEmailRead`, `starEmail`, `moveEmail` (SimpleIMAPService); `verifyConnection`, `sendEmail`, `sendTestEmail`, `close` (SmtpService). `saveDraft` was already documented.

---

## NEW — Cycle #11 Findings

### [DONE - Cycle 12] `smtp-service.ts` `wipeCredentials()` — remaining `as any` casts
Removed 3 `as any` casts from `wipeCredentials()`. Direct property writes compile cleanly against `SMTPConfig`.

### [DONE - Cycle 12] `clearCache()` in `simple-imap-service.ts` — missing JSDoc
Added one-line JSDoc to `clearCache()`.

### [DONE - Cycle 12] `security/memory.ts` `scrubEmail()` — 5 spurious `as any` casts
Removed all 5 casts in `scrubEmail()`. `EmailMessage.body/subject/from` and `EmailAttachment.filename` are non-optional mutable strings; `EmailAttachment.content` is already optional. Direct writes compile cleanly.

**Zero avoidable `as any` casts remain in any production code file.**

---

---

## NEW — Cycle #12 Findings

### [DONE - Cycle 13] `SimpleIMAPService.healthCheck()` — NOOP-based connection probe
Added `async healthCheck(): Promise<boolean>`. Issues `this.client.noop()`. Returns true on success, false on any failure or when disconnected. Never throws. 5 new unit tests added.

### [DONE - Cycle 13] DRY — numeric emailId guard in 12+ handlers
Extracted `requireNumericEmailId(raw: unknown, fieldName?: string): string` to `src/utils/helpers.ts`. Throws `McpError(InvalidParams, ...)` on failure. Replaced all 12 guard sites in `src/index.ts`. 14 new unit tests added.

### [DONE - Cycle 14] Wire `healthCheck()` into `get_connection_status`
Added `healthy: await imapService.healthCheck()` to the `imap` sub-object of the `get_connection_status` response. Updated `outputSchema` to declare the new field. NOOP probe now surfaced to agents.

### [DONE - Cycle 14] Inline label validation in `move_to_label` / `bulk_move_to_label`
Both handlers now call `validateLabelName()` instead of 3 inline if-blocks each. Net -14 lines in `src/index.ts`. Behavior unchanged; all existing tests cover the validation paths.

### 27. Error message clarity for lost IMAP connections
**File:** `src/services/simple-imap-service.ts`
**Issue:** When IMAP connection is lost and an operation is attempted, the raw imapflow error propagates. Wrapping `ensureConnection()` failures with a friendly "IMAP connection lost; reconnect via the settings tool." message would improve user experience. Assessed in Cycle #14 — existing messages are reasonably clear (logged with context). Low priority.
**Effort:** LOW
**Risk:** LOW

---

---

## NEW — Cycle #14 Findings

### [DONE - Cycle 15] `save_draft` / `schedule_email` / `send_email` attachment validation (carried from Cycle #8)
Added `validateAttachments()` helper to `src/utils/helpers.ts`. Called in all three handlers. Returns `McpError(InvalidParams)` for non-array input, primitive array items, missing/wrong-type filename, missing/null/wrong-type content, or wrong-type contentType. 23 new tests added. 416 tests total.

### [DONE - Cycle 16] README accuracy — tool count and `get_connection_status` description
Corrected tool count from 45 → 47 in README tagline, README Full Access preset row, and CHANGELOG [2.1.0]. Extended `get_connection_status` table description to mention `imap.healthy` (NOOP probe) and `insecureTls` fields. Added comprehensive `[Unreleased]` CHANGELOG section documenting all Cycle #1–#15 improvements.

### [DONE - Cycle 17] README — all 5 MCP prompts now listed
Expanded README "MCP Prompts" subsection from a 3-item bullet list to a 5-row table. Added `triage_inbox` (limit, focus args) and `daily_briefing` (no args). Now matches all 5 prompts registered in `ListPromptsRequestSchema` in `src/index.ts`.

### [DONE - Cycle 17] Settings UI embedded HTML — "40 tools" corrected to "47 tools"
Fixed two occurrences of "All 40 tools" in `src/settings/server.ts` (preset comparison table + setup wizard card). Now consistent with README and CHANGELOG (all say 47).

### 31. `ensureConnection()` friendly error wrapping — CLOSED (Cycle #18 re-assessment)
**Status:** No action needed. Re-assessed in Cycle #18:
- Read-path methods catch and return empty arrays on reconnect failure.
- Write-path errors propagate to the top-level `safeErrorMessage()` handler which maps IMAP messages to "IMAP operation failed".
- Error handling is correct and user-friendly. Closing this item.

### [DONE - Cycle 18] `get_connection_status` outputSchema accuracy
Added 6 missing fields to outputSchema: `smtp.lastCheck`, `smtp.insecureTls`, `smtp.error`, `imap.insecureTls`, `settingsConfigured`, `settingsConfigPath`.

### [DONE - Cycle 18] `list_scheduled_emails` outputSchema missing `retryCount`
Added `retryCount` field to the scheduled item properties in the outputSchema.

### [DONE - Cycle 19] `get_email_analytics` outputSchema — 4 incomplete entries
Expanded `topSenders`, `topRecipients`, `peakActivityHours`, and `attachmentStats` from bare `{type:"object"}` to full typed schemas matching the `EmailAnalytics` interface.

### [DONE - Cycle 19] `get_contacts` outputSchema — 4 missing Contact fields
Added `name`, `firstInteraction`, `averageResponseTime`, `isFavorite` to the contact item schema to match the full `Contact` interface.

---

## FUTURE / ARCHITECTURAL

### 5. Cursor token HMAC binding
**File:** `src/index.ts` cursor encode/decode
**Issue:** The cursor is base64url-encoded JSON `{folder, offset, limit}`. Adding HMAC would bind the cursor to the server instance (prevents cursor forgery across restarts).
**Effort:** Low-medium, low security impact
**Status:** DEFERRED — low risk (folder field already traversal-validated; no sensitive data in cursor). Revisit if multi-instance deployment is planned.

### 6. IMAP connection health check / reconnect on error
**File:** `src/services/simple-imap-service.ts`
**Issue:** `ensureConnection()` only checks `isConnected` flag. If IMAP server drops without a 'close' event (TCP RST), `isConnected` stays true and next op throws. Proactive NOOP check would be more robust.
**Effort:** Medium, moderate risk
**Status:** PARTIALLY ADDRESSED — `healthCheck()` NOOP probe added (Cycle 13), surfaced in `get_connection_status` (Cycle 14). Full proactive background reconnect deferred: read-path catches errors; write-path maps to safeErrorMessage. Low marginal value.

---

IMPROVEMENT CYCLES COMPLETE — 2026-03-18 — 21 cycles (Cycle #21: documentation accuracy fixes)
