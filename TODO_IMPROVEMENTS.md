# TODO Improvements — Prioritized Backlog

Last updated: Cycle #1 (2026-03-17)

---

## HIGH PRIORITY

### [DONE - Cycle 1] Path traversal in label/folder handlers
Fixed in `get_emails_by_label`, `move_to_folder`, `remove_label`, `bulk_remove_label`.

---

## MEDIUM PRIORITY

### 1. `SchedulerService` — items array unbounded growth
**File:** `src/services/scheduler.ts`
**Issue:** The `this.items` array grows indefinitely with completed/failed/cancelled records. In a long-running deployment with many scheduled emails, this could cause high memory use and slow JSON serialization on every persist.
**Fix:** On `load()` and/or `persist()`, prune records with status != "pending" that are older than 30 days. Cap total non-pending records at e.g. 1000.
**Effort:** ~15 lines, low risk
**Test:** Add test verifying old completed records are pruned

### 2. Add test coverage for new input validation
**File:** new test file or additions to existing test files
**Issue:** The 4 handlers fixed in Cycle 1 have no unit tests for the new validation paths.
**Fix:** Add test cases for: empty label, label with `/`, label with `..`, label with control chars, label over 255 chars. Same for `move_to_folder` folder arg and `remove_label`/`bulk_remove_label` targetFolder.
**Effort:** ~40 lines across test files, no risk

### 3. `Analytics.getEmailStats()` — spread on large array
**File:** `src/services/analytics-service.ts` line ~131
**Issue:** `Math.min(...allEmails.map(...))` and `Math.max(...)` use spread which can fail with "Maximum call stack size exceeded" for very large arrays (>100K entries). In practice capped at 300 emails (200 inbox + 100 sent), but this is an implicit assumption.
**Fix:** Replace with `allEmails.reduce((acc, e) => Math.min(acc, e.date.getTime()), Infinity)` pattern.
**Effort:** 2 lines, low risk

---

## LOW PRIORITY

### 4. Fix comment numbering in graceful shutdown
**File:** `src/index.ts` lines ~2613 and ~2618
**Issue:** Two consecutive step labels both read "// 3." — second should be "// 4."
**Effort:** 1 line change, cosmetic

### 5. `list_labels` detection logic cleanup
**File:** `src/index.ts` line ~1686
**Issue:** `f.name?.startsWith("Labels/")` check is redundant — IMAP folder `name` is the leaf name without path prefix, so it would never start with "Labels/". Only `path` check is needed.
**Fix:** Remove the `|| f.name?.startsWith("Labels/")` redundant condition.
**Effort:** 1 line, cosmetic, low risk

### 6. `parseEmails` — silent dropping of invalid addresses
**File:** `src/utils/helpers.ts`
**Issue:** Invalid addresses in a comma-separated list are silently dropped. If the caller provides "valid@x.com, notanemail", only the valid one is used with no warning. The log entry in the SMTP service doesn't identify which specific address was invalid.
**Fix:** Either log a warning for dropped addresses, or return a richer object `{valid: string[], dropped: string[]}`. The second approach requires caller changes.
**Effort:** Medium (~20 lines + caller updates), low risk

### 7. `send_test_email` validation — friendly error
**File:** `src/index.ts` case `send_test_email`
**Issue:** `args.to` is not validated before passing to `smtpService`. If invalid, the error propagates from inside the SMTP service and gets caught by `safeErrorMessage` which may strip detail. Other send handlers have the same implicit-validation-via-SMTP pattern.
**Fix:** Add `isValidEmail(args.to)` check at the handler level with a clear error message, consistent with the approach used in `send_email`.
**Effort:** ~5 lines, low risk

---

## FUTURE / ARCHITECTURAL

### 8. IMAP connection health check / reconnect on error
**File:** `src/services/simple-imap-service.ts`
**Issue:** `ensureConnection()` only checks `isConnected` flag. If the IMAP server drops the connection without emitting a 'close' event (e.g., TCP RST), `isConnected` stays true and the next operation throws. A proactive health-check (e.g., NOOP command) before operations would be more robust.
**Effort:** Medium, moderate risk (could affect connection stability)

### 9. Cursor token includes folder name in plaintext
**File:** `src/index.ts` cursor encode/decode
**Issue:** The cursor is base64url-encoded JSON `{folder, offset, limit}`. While not sensitive, the folder name is exposed in the cursor token. Consider using HMAC to bind the cursor to the server instance (prevents cursor forgery across restarts). Low security impact since the folder is already known to the caller.
**Effort:** Low-medium, low risk

---
