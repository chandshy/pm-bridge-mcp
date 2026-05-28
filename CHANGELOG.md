# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.45] — 2026-05-28

### Fixed
- **IMAP IDLE loop silently downgraded to insecure TLS when cert load failed** (IMAP-001 from the 2026-05-28 audit). `runIdleLoop` always fell through to `{ rejectUnauthorized: false }` whenever `readPinnedBridgeCert` threw or `bridgeCertPath` was absent — completely ignoring the `allowInsecureBridge` opt-in that the main `connect()` path enforces. An operator who pinned a cert (or never opted into the legacy localhost behaviour) would unknowingly run the IDLE socket downgraded forever. The IDLE loop now mirrors `connect()`'s contract: if `allowInsecureBridge` is unset and `MAILPOUCH_INSECURE_BRIDGE !== '1'`, a missing/broken cert is logged at error level and the IDLE loop refuses to start (`idleActive = false`).
- **Six bulk IMAP paths joined unbounded UID sets into a single command** (IMAP-002). `bulkMoveEmails`, `bulkDeleteEmails`, `bulkMarkRead`, `bulkStar`, `bulkCopyToFolder`, `bulkDeleteFromFolder`, and the pre-flight in `findExistingUidsInLockedFolder` all built `present.join(',')` with no upper bound — Proton Bridge caps IMAP command lines around 8 KB, so ~800 nine-digit UIDs already crashed the batch and forced the per-UID fallback (minutes of held mailbox lock for what should be one round-trip). New `chunkUidsForWire(uids, maxLen=7500)` helper splits the UID list into bytes-bounded chunks; new private `chunkedBatchOp(present, perChunk, perUid, …)` runs the chunked call and falls back per-UID only for the failing chunk. All six bulk methods and the existence pre-flight now route through these helpers.
- 9 new regression tests added (`chunkUidsForWire` boundary cases, `bulkDeleteEmails` 2000-UID splitting, per-chunk fallback isolation, IDLE TLS refusal for both no-cert and broken-cert paths). Unit suite: 1640 passes.

## [3.0.44] — 2026-05-28

### Fixed
- **`bulkMarkRead` / `bulkStar` / `bulkCopyToFolder` defaulted to INBOX on cache miss** (IMAP-003 from the 2026-05-28 audit) — the three sibling bulk methods missed by the v3.0.41 fix. When `sourceFolder` was absent and the UID wasn't cached, they silently grouped the UID under `'INBOX'`, recreating the false-success class for these three operations. They now mirror the `bulkMoveEmails` pattern: cache lookup, then `getEmailById()` discovery, then explicit failure if still not found.
- **`findExistingUidsInLockedFolder` silently lied about UID absence on transport errors** (IMAP-006). The pre-flight FETCH used to `catch (e) { logger.warn(...); return new Set(); }`, which collapsed network/BAD/command-too-long errors into "UIDs not found" — a flat-out misrepresentation. It now rethrows; every bulk caller wraps the call in its own catch that surfaces `UID X existence check failed in folder Y: <reason>` so callers can distinguish "definitely absent" from "couldn't verify."
- **`setFlag` was missed by the v3.0.41 fix entirely** (IMAP-008, IMAP-009). Now (a) accepts an optional `sourceFolder` parameter, locking it directly and skipping the all-folders scan; (b) runs the same pre-flight `findExistingUidsInLockedFolder` UID check as every other mutator, so silent IMAP STORE no-ops on missing UIDs surface as honest errors.
- **`getEmailById` accepted unvalidated `folderHint`** (VALID-001). Six reading/sending tool handlers (`get_email_by_id`, `get_thread`, `extract_action_items`, `extract_meeting`, `reply_to_email`, `forward_email`) forwarded `args.folder` raw via `as string | undefined`. The service now calls `validateFolderName(folderHint)` defensively, and the tool handlers route the arg through a new `optionalFolderHint()` helper in `src/utils/helpers.ts` that produces a clean `McpError(InvalidParams, …)` before the IMAP wire. Also closes the related VALID-009 sibling at the tool layer.
- 9 new regression tests added in `src/services/imap-operations.test.ts` covering each bullet above. Unit suite: 1631 passes. E2E Greenmail (CI mode) green.

## [3.0.43] — 2026-05-28

### Fixed
- **preship gate's `npm-audit` step was advisory, not hard** (DOCS-009 from the 2026-05-28 audit). `docs/preship.md` advertised HIGH/CRITICAL CVE findings as ship-blocking — and the v3.0.42 CHANGELOG said the same — but `scripts/preship.mjs` wrapped the step with `mode: "advisory"`, so the gate exited 0 even when `check-npm-audit.mjs` returned 1. Step is now `mode: "hard"` with `successWhen: code === 0 || code === 2` so MODERATE/LOW (exit 2) print as warnings without blocking and HIGH/CRITICAL (exit 1) block the gate as documented.
- **`PRESHIP_SKIP=1` bypass was documented but unimplemented** (BUILD-014). The merge-pr skill's Step 2 references it; `docs/preship.md`'s "Bypassing the gate" table promised it. Now implemented at the top of `scripts/preship.mjs` — short-circuits with a loud `BYPASS: PRESHIP_SKIP=1` line to stderr so the bypass leaves an audit trail.
- **`npm-version-free` advisory inverted on network failure** (BUILD-002). The previous `successWhen: code !== 0 || !output.trim()` declared "version not yet on npm" whenever `npm view` failed — including when the registry was unreachable. Now distinguishes E404 (truly free), explicit "version listed" (already published), and unknown failure (printed as "could not verify (registry unreachable?)").
- **`LICENSES.json` baseline recorded 11 prod deps as `(unknown)`, neutering drift detection** (BUILD-004). `npm ls --omit=dev --long` returns nodes without `version` for off-platform native optionals; recording them produced false add/remove churn on every install. Check now filters unresolved-version deps from both current and baseline sets and surfaces them in a "skipped" diagnostic. Baseline regenerated; 180 prod deps tracked, 11 skipped.
- **`check-licenses.mjs` first-run silently staged a baseline AND failed** (BUILD-005). First run now errors with `license-inv ERROR: no baseline. Generate with: PRESHIP_LICENSE_WRITE=1 …` without writing — operators review and commit the baseline explicitly.
- **`tarball-smoke` only validated `--version` and never exercised packed-files presence** (BUILD-006). `--version` short-circuits before tray load; a missing `native/tray/index.js` would not have surfaced. Smoke now additionally runs `tar -tzf` against the produced tarball and asserts five required paths (`package/native/tray/index.{js,d.ts}`, `package/dist/{index,settings-main,utils/tray}.js`) are present.
- **Audit doc shipped** at `docs/audit-2026-05-28.md` — 241 findings across 12 detective beats from the full-repo audit. This release closes 1 High + 5 Medium from the audit; the remaining 25 Critical+High items land in v3.0.44 … v3.0.51 per the plan at `~/.claude/plans/bright-stirring-gray.md`.

## [3.0.42] — 2026-05-28

### Added
- **E2E test harness (`test/e2e/`)** — two-phase end-to-end coverage that drives the real mailpouch MCP server over stdio: Phase 1 against Greenmail in Docker (`npm run test:e2e:local`, 62 passing tests across 10 scenario files), Phase 2 against live Proton Bridge (`npm run test:e2e:bridge`, opt-in via `MAILPOUCH_E2E_BRIDGE_CONFIG`). Each scenario asserts on actual IMAP state via `imapflow` rather than tool return values — the property that catches false-success counters like the 3.0.41 bug class. `ImapFixtures` helper, deterministic seed data, container lifecycle helper, orphan-cleanup script for Phase 2. Full docs at `test/e2e/README.md`.
- **Permanent ship-readiness gate (`npm run preship`)** — single-command audit that runs typecheck, lint, version/CHANGELOG/README sync, secret scan (gitleaks with grep fallback), `npm audit` (HIGH/CRITICAL blocking; MODERATE/LOW advisory), license inventory drift check, build, unit tests, `npm pack` install smoke, Greenmail E2E, and Bridge E2E in deterministic order with a clear pass/fail summary table. Three depth levels: `preship:fast` (<30 s, runs in pre-push hook), `preship` (~5 min, for `/ship`), `preship:release` (adds tag/changelog-body/npm-version checks; wired to `prepublishOnly` so `npm publish` cannot run without it). Five standalone check scripts (`npm run check:version-sync`, `:secrets`, `:npm-audit`, `:licenses`, `:tarball`) for debugging individual failures. `.preship-audit-allow.json` for acknowledging specific advisories; `LICENSES.json` is the committed prod-dep license baseline (regenerate with `PRESHIP_LICENSE_WRITE=1`). New `.github/workflows/preship.yml` runs the gate on every PR with Greenmail as a service container (Bridge is `PRESHIP_NO_BRIDGE=1`-skipped on hosted runners; documented in `docs/preship.md`). `simple-git-hooks` installs a pre-push hook running `preship:fast`. `merge-pr` skill picks up `npm run preship` as Step 2 — every `/ship` is gated by it unless `PRESHIP_SKIP=1` is set as an emergency escape hatch.
- **`mailpouch --version` / `-v`** — short-circuits before any side effects and prints `mailpouch vX.Y.Z`. Used by the `tarball-smoke` preship step and routinely by users to identify the installed binary.

### Fixed
- **`optionalSourceFolder()` validator mismatch (follow-up to 3.0.41)** — `src/tools/actions.ts` and `src/tools/deletion.ts` were calling `validateFolderName()` (leaf-only, rejects `/`) for the `sourceFolder` argument. Every `sourceFolder: "Folders/X"` would have returned `Invalid sourceFolder` — a self-inflicted bug in the 3.0.41 fix caught by the new E2E harness. Now uses `validateTargetFolder()` which allows full IMAP paths.

## [3.0.41] — 2026-05-28

### Fixed
- **Mutating tools silently no-op'd when UIDs lived outside INBOX (Bugs A/B/C from 2026-05-28 report)** — `bulk_move_emails`, `move_email`, `bulk_mark_read`, `bulk_star`, `bulk_move_to_label`, `bulk_remove_label`, `bulk_delete_emails`, `delete_email`, `mark_email_read`, `star_email`, `archive_email`, `move_to_trash`, `move_to_spam`, `move_to_folder`, and `move_to_label` resolved the source folder via a cache lookup that scanned every folder for a matching UID. IMAP UIDs are folder-scoped, so the wrong folder would be selected (or INBOX defaulted) and the IMAP UID MOVE/STORE/DELETE would silently no-op while the tool reported `{ success: N, failed: 0 }`. Added an optional `sourceFolder` parameter to every mutating tool; when supplied it skips the cache lookup and locks the explicit folder. Strongly recommended whenever the UIDs came from a folder other than INBOX.
- **Success counters lied (Observation O2)** — counters were incremented unconditionally after each IMAP call. Added a UID FETCH pre-flight inside the folder lock to determine which UIDs actually exist there; missing UIDs are now reported in `failed`/`errors` rather than counted as success. Affects every bulk and singular mutation.
- **`bulk_remove_label` / `remove_label` `targetFolder` argument removed** — the parameter was schemaed but never plumbed to the IMAP call. Tools now document that callers must pass label-folder UIDs (Proton Bridge's label folders have their own UID space).

## [3.0.40] — 2026-05-27

### Fixed
- **Settings UI: page hangs after header load** — unescaped apostrophe in a JS string literal inside the `buildShellHtml` template literal. `\'` inside a TS template literal produces `'` in output, breaking the generated JS string `'This removes the server's ability...'` with a syntax error. The entire `<script>` block failed to parse, so the IIFE never ran and the page never initialized. Fixed by using `\\'` to produce a properly escaped `\'` in the output.

## [3.0.39] — 2026-05-27

### Fixed
- **Settings UI: native alert()/confirm() dialogs replaced** — all 13 `alert()` and 7 `confirm()` calls in the settings UI replaced with styled alternatives. Informational alerts become `toast()` notifications (red for errors, green for success, orange for warnings). Destructive confirmations use a new shared confirm modal that matches the UI's dark-theme design and supports per-action titles, body text, and button labels.

## [3.0.38] — 2026-05-27

### Fixed
- **Settings UI: all buttons and tabs unresponsive** — CSP3 spec: when any nonce appears in `script-src`, `'unsafe-inline'` is completely ignored for ALL inline scripts in that directive — including `onclick=`, `oninput=`, and `onchange=` event handlers. Every interactive element in the settings UI used inline handlers, so nothing worked. Fixed by replacing all inline event handlers across `shell.ts` and all 7 tab files with `data-action`/`data-tab`/`data-change`/`data-input` attributes dispatched by a central delegated listener inside the nonce-protected `<script>` block. Also corrected the false code comment in `server.ts` that claimed `'unsafe-inline'` "still covers inline onclick handlers (browser carve-out)".

## [3.0.37] — 2026-05-27

### Fixed
- **Settings UI: inline styles blocked by CSP** — `style-src` included a nonce alongside `'unsafe-inline'`. Per CSP3 spec, when any nonce is present in a directive's source list, `'unsafe-inline'` is completely ignored for that directive — including `element.style.*` JavaScript assignments and `style=""` HTML attributes. This caused every show/hide operation in the settings UI to be silently blocked (modals, tab switches, status indicators all invisible). Fixed by removing the nonce from `style-src`; the nonce is only meaningful for `script-src` where it gates `<script>` block execution.

## [3.0.36] — 2026-05-27

### Documentation
- **`draft_in_my_voice` prompt documented** — the 6th built-in MCP prompt was registered in code but absent from all user-facing docs. Added to `README.md` (Key Features + MCP Prompts table), `README_FIRST_AI.md` (MCP Prompts section), and `HELP.md` (new MCP Prompts subsection).
- **`get_server_version` tool documented** — added to the System tools section in `README_FIRST_AI.md` (5th system tool, core tier).
- **Destructive tools lists updated** — `shutdown_server` and `restart_server` (added to `DESTRUCTIVE_TOOLS` in 3.0.35) were missing from agent and user docs. Added to: `llms.txt` key facts, `README_FIRST_AI.md` operating guidelines, `HELP.md` destructive-confirmation section.
- **Stale counts corrected** — `llms.txt` claimed 71 tools (→ 70); `README.md` claimed 5 MCP prompts (→ 6) and 1,649 tests (→ 1,611); `llms.txt` core tier claimed ~26 tools (→ ~27). npm version badge in `README.md` updated (3.0.27 → 3.0.35).

## [3.0.35] — 2026-05-27

### Fixed
- **`shutdown_server` / `restart_server` bypassed `requireDestructiveConfirm`** — both tools carry `destructiveHint: true` in their MCP annotations but were absent from `DESTRUCTIVE_TOOLS`. The CallTool gate checks that set, not the annotation, so when `requireDestructiveConfirm: true` was set these two operations silently skipped the `{ confirmed: true }` guard. Added to `DESTRUCTIVE_TOOLS`; also added a regression test.
- **`pass_get` annotation contradicted its destructive gate** — the tool was correctly listed in `DESTRUCTIVE_TOOLS` (credential retrieval warrants the confirm guard) but its MCP annotation was `readOnlyHint: true`, telling clients it was safe and non-modifying. Changed to `destructiveHint: true` to match the gate.
- **Stale tier-count comments** — `TOOL_CATEGORY_TIER` comments claimed "~26 / ~28" for core and "~50" for extended; actual cumulative counts are 27/29 and 64/66 respectively (aliases + pass were added to extended after the comments were written). Replaced the inline estimates with a precise breakdown table.
- **README tool count stale** — three mentions of "69 tools" updated to "70 tools" following the addition of `get_server_version` in 3.0.34.

## [3.0.34] — 2026-05-27

### Added
- **`get_server_version` tool** — agents can now query the running server version directly via MCP (`get_server_version` → `{ version: "3.0.34" }`). Belongs to the `system` / `core` tier so it is always available.
- **Version label in tray icon menu** — both the MCP server tray and the standalone settings-daemon tray now display the running version (e.g. `v3.0.34`) as a disabled menu item below the `mailpouch` header.

## [3.0.33] — 2026-05-27

### Fixed
- **Settings page completely non-interactive** — the CSP header used `style-src/script-src 'nonce-...'` without `'unsafe-inline'`. CSP3 nonces cover `<script>`/`<style>` block elements but do NOT cover (a) inline `onclick="..."` event handlers or (b) `style="..."` attributes on HTML elements. Effect: every button click was silently swallowed, and every `style="display:none"` attribute was ignored — causing the "Approve with conditions" grant modal and other hidden elements to render in normal document flow on top of the settings content. Added `'unsafe-inline'` to both directives; in CSP3 browsers the nonce still gates `<script>`/`<style>` blocks (nonce overrides unsafe-inline for those), while unsafe-inline covers event handlers and inline style attributes.
- **Wizard-view flash on load** — `#wizard-view` CSS had `display:flex` as its default, so an empty flex container was briefly visible before JavaScript ran. Changed default to `display:none`; the JS sets `display:flex` explicitly when the wizard is needed.

## [3.0.32] — 2026-05-27

### Fixed
- **Tray Quit now exits reliably** — `gracefulShutdown` previously called `imapService.disconnect()` and `smtpService.close()` on a dead TCP socket (Bridge off), which could hang indefinitely and prevent `process.exit()` from ever running. Fixed by: (1) destroying the tray icon before any async cleanup so the icon vanishes immediately on click; (2) adding a 5 s hard-exit timeout so the process always terminates even if IMAP/SMTP teardown stalls; (3) adding a 50 ms D-Bus flush pause after cleanup so the native SNI deregistration message lands before fds close.
- **Process stays alive after MCP client disconnect** — when Claude cowork (or any stdio MCP client) exits, stdin closes but the settings server + tray were keeping the event loop alive indefinitely. The process now listens for `stdin close` and calls `gracefulShutdown` automatically so the tray icon disappears when the client goes away.
- **Duplicate shutdown guard** — added `_shutdownInProgress` flag so concurrent SIGINT/SIGTERM/tray-quit signals don't race through multiple `gracefulShutdown` invocations.

## [3.0.31] — 2026-05-27

### Changed
- **Settings page tab lazy-loading** — the 5551-line `server.ts` monolith is split into focused modules: `shell.ts` (page shell + all JS), `styles.ts` (CSS), and `src/settings/tabs/{wizard,setup,permissions,accounts,agents,status,logs}.ts`. A new `GET /api/tab/:name` route serves each tab's HTML on first click; subsequent visits use the cached fragment. A broken tab shows an inline error without affecting other tabs. The route uses a `Set`-based allowlist to block prototype-pollution attempts (`__proto__`, `constructor`, etc.).
- **Concurrent tab-click deduplication** — rapid double-clicks on a tab now await the same in-flight fetch via a `_tabLoading` Map rather than launching duplicate requests.
- **Hardcoded colors replaced with CSS variables** — grant-approval modal and accounts modal no longer use literal `#1b1b1e`, `#222`, `#444`, etc.; all colors now reference `var(--surface)`, `var(--border)`, `var(--text)`, etc.

### Fixed
- **`validateAttachments` unbounded array** — `attachments` arrays are now capped at 50 items; previously an arbitrarily large array would pass validation and be forwarded to the MIME builder.
- **Bulk-op silent INBOX fallback now logged** — `bulkMarkRead`, `bulkStar`, and `bulkCopyToFolder` emit a `warn`-level log entry when a UID is not in the email cache and the operation falls back to INBOX, making the pre-existing design limitation observable.

## [3.0.30] — 2026-05-27

### Fixed
- **`parseEmails` now accepts "Display Name \<email\>" format** — previously `send_email` (and `schedule_email`) would silently drop any To/CC/BCC address passed as `"John Doe <john@example.com>"` because `isValidEmail` rejects spaces. The address portion inside angle brackets is now extracted before validation, so both bare-address and display-name formats are accepted.

## [3.0.29] — 2026-05-27

### Fixed
- **Remaining UID-scope holes in five tools** — `reply_to_email`, `forward_email`, `get_thread`, `extract_action_items`, and `extract_meeting` all called `getEmailById(uid)` without a folder hint, leaving them vulnerable to the same cross-folder UID collision fixed in 3.0.28. Each tool now accepts an optional `folder` parameter (schema + handler) that is forwarded as the `folderHint` to `getEmailById`.

## [3.0.28] — 2026-05-27

### Fixed
- **UID-scoping bug (root cause for Bugs 1, 2, 4)** — IMAP UIDs are per-mailbox, not globally unique. The email cache was keyed by bare UID, so UID 63 in Drafts collided with UID 63 in INBOX. Cache keys are now `${folder}:${uid}` throughout. A new `findCacheEntryByUid(uid)` linear-scan helper covers callers that don't know the folder in advance (single-email `setFlag`, `downloadAttachment`, bulk fallback paths).
- **`search_emails` deadlock / timeout (Bug 3)** — `searchSingleFolder` held the imapflow mailbox lock, then called `getEmailById` which attempted to acquire a second lock on the same connection. imapflow serializes lock acquisitions, so the inner lock request never resolved → MCP timeout (-32001). Fixed by fetching messages directly within the already-held lock instead of delegating to `getEmailById`.
- **`search_emails` folder-scope leak (Bug 2)** — because of the cache collision, a hit for UID 63 in the wrong folder was returned as a Drafts result. Eliminated by the UID-scoping fix above.
- **`get_email_by_id` wrong-folder result (Bug 1)** — same root cause. `get_email_by_id` now accepts an optional `folder` param; when provided, it constrains both the cache lookup and the IMAP search to that folder only.
- **`remind_if_no_reply` wrong-message + opaque error (Bug 4)** — now accepts an optional `folder` param (default "Sent") passed to `getEmailById`. Added `fireAt > now` guard to reject reminders that would fire immediately in the past. Wrapped fetch and persist steps in try/catch that surfaces the real exception instead of swallowing it as "An error occurred".
- **Destructive bulk operations UID safety** — `bulkMoveEmails`, `bulkDeleteEmails`, and `bulkDeleteFromFolder` no longer assume uncached emails live in INBOX. They now call `getEmailById` to discover the real folder before operating, and count "email not found" as a per-item failure rather than silently operating on the wrong folder.

## [3.0.27] — 2026-05-26

### Docs
- **`docs/proton-bridge-overview.md`** — new "Supported Bridge Versions" section pinning Bridge v3.24.x (Nescio, latest v3.24.2 2026-04-20) as the tested baseline. Calls out the IMAP connection limiting added in v3.24.0 and the label-endpoint mapping churn across v3.23.0 → v3.24.1 so future debugging has the upstream version context. No code changes.

## [3.0.26] — 2026-05-26

### Changed
- **Dependency bumps** (Dependabot, #117/#121/#122/#123/#124):
  - `better-sqlite3` 12.9.0 → 12.10.0 (patch)
  - `nodemailer` 8.0.7 → 8.0.8 (patch)
  - `@types/node` 25.6.0 → 25.9.1 (dev, minor)
  - `vitest` 4.1.5 → 4.1.7 (dev, patch)
  - `@vitest/coverage-v8` 4.1.5 → 4.1.7 (dev, patch)

## [3.0.25] — 2026-05-26

### Fixed
- **Remaining bulk handlers — single batched IMAP per folder** — `bulk_mark_read`, `bulk_star`, `bulk_move_to_label`, and `bulk_remove_label` no longer loop over single-email IMAP calls. New `ImapService` methods `bulkMarkRead`, `bulkStar`, `bulkCopyToFolder`, and `bulkDeleteFromFolder` each issue a single `UID STORE` / `UID COPY` per source folder, with a per-folder fallback to per-UID commands on batch error. Closes the same class of regression as #120 for the four handlers that were left as follow-up because no batch service method existed yet.
- **All bulk handlers post-filter guard** — all-invalid emailIds (after the `/^\d+$/` filter) now throws `InvalidParams` instead of silently returning `{success:0, failed:0, errors:[]}`.

## [3.0.24] — 2026-05-26

### Security
- **Credential encryption — per-system entropy (v2 blob format)** — the AES-256-GCM key for `passwordEncrypted` / `smtpTokenEncrypted` is now derived from `machine-id || hostname || salt || platform`. The previous v1 derivation used only `hostname || salt || platform`, so a VM/container clone (or any host sharing hostname + platform) could decrypt credentials from a sibling install. Machine secret resolved in priority order: `/etc/machine-id`, `/var/lib/dbus/machine-id`, macOS `IOPlatformUUID`, Windows `MachineGuid`, then a per-install `~/.mailpouch-machine-id` (mode 0600) as fallback. `MAILPOUCH_MACHINE_SECRET` env override for containers / tests.
- **Transparent v1 → v2 migration** — existing encrypted blobs continue to decrypt with the legacy key; `migrateCredentials()` (run at every startup) upgrades v1 blobs in place by decrypting with the old key and re-encrypting with the new key. Operators never have to re-enter credentials.

## [3.0.23] — 2026-05-26

### Security
- **`pass-cli` env hardening** — the Proton Pass subprocess now receives only `PATH`, `HOME`, `LANG`, `LC_ALL`, and `PROTON_PASS_PAT`. Previously it inherited the full parent `process.env`, so a compromised CLI binary would have read every other credential the server held.
- **`pass-cli` PATH resolution** — bare-name `passCliPath` is now resolved via `which` at startup and validated against a trusted prefix list (`/usr/bin`, `/usr/local/bin`, `/opt/`, `/bin/`, `/opt/homebrew/bin/`). Refuses agent-writable PATH directories like `~/.local/bin` that could shadow the real binary.
- **Bridge shutdown by PID** — `killProtonBridge()` now records the spawn PID and kills that PID directly (SIGTERM, then SIGKILL after 2 s). Replaces `pkill -f proton-bridge`, which matched the full command line and could kill any unrelated process whose argv contained that string.
- **Bridge TOCTOU** — dropped the `existsSync(bridgePath)` pre-check that opened a swap window between check and spawn.
- **Bridge cert pinning** — the configured CA cert is now hashed on first read; subsequent reads verify the hash and refuse the connection on mismatch. Closes the TLS-cert-swap TOCTOU.
- **AppleScript injection** — `escAppleScript()` strips ASCII control chars (0x00–0x1F + 0x7F) in addition to escaping `"` and `\`. Agent-supplied notification reasons can no longer break out of the `display notification … with title …` clause.
- **Windows toast XML injection** — new `escXml()` HTML-escapes `& < > " '` for all content embedded in the WinRT toast XML before the PowerShell single-quote layer.
- **Self-signed cert cleanup** — `tryGenerateSelfSignedCert()` now `rmSync`s its temp directory in a `finally{}` block. A crash no longer leaves the generated private key in `/tmp`.
- **OAuth admin password + bearer token encryption** — `remoteBearerToken` and `remoteOauthAdminPassword` are now migrated into the OS keychain on first run alongside `password`/`smtpToken`. Previously these two equally-valuable secrets were the only credentials still stored plaintext in `~/.mailpouch.json`.
- **Token revocation propagation** — outstanding OAuth access tokens are immediately invalidated when a grant transitions to revoked/denied/expired. Previously tokens stayed valid until the 24 h TTL.
- **Token IP pinning** — `IssuedToken` records the issuing client IP; `verifyToken()` rejects mismatched-IP requests. Closes the "issue from loopback, replay from remote" gap even when no per-agent `ipPins` are configured.
- **IPv6 X-Forwarded-For loopback gap** — the loopback check that gated XFF trust now accepts only exact `127.0.0.1` / `::1` / `::ffff:127.0.0.1`. Other IPv4-mapped IPv6 loopback variants (common in dual-stack containers) no longer admit a spoofed X-Forwarded-For.
- **Logger redaction expansion** — `cookie` and `oauth` field families now redacted alongside `password`, `token`, `secret`, etc.
- **Settings UI CSP nonces** — dropped `'unsafe-inline'` for both `script-src` and `style-src`. A fresh 128-bit nonce is generated per response and emitted on the CSP header and on every inline `<script>` / `<style>` tag.
- **Access token: header-only** — query-string `?token=` removed. Tokens in URLs leak into browser history, referer headers, and proxy logs.
- **HSTS** — upgraded to `max-age=31536000; includeSubDomains; preload`.
- **Mode 0600 sweep** — `~/.mailpouch.log` and `~/.mailpouch-fts.db` (plus `-wal` / `-shm` / `-journal` siblings) are now explicitly chmod'd to 0600 after creation.
- **PKCE strictness** — `code_challenge` and `code_verifier` are now validated as 43–128 chars of base64url alphabet (`[A-Za-z0-9_\-.~]`) before SHA-256, blocking short-verifier brute-force.
- **Authorization-code error opacity** — unknown code, wrong `client_id`, wrong `redirect_uri`, and PKCE-mismatch all return the same `invalid_grant: "Invalid authorization code."` message. No more client-id enumeration via error-string differences.
- **LAN origin: IPv6 ULA / link-local** — origin validation in LAN mode now admits `fc00::/7`, `fd00::/8`, and `fe80::/10` alongside IPv4 RFC-1918.
- **Tool-permissions allowlist** — POST `/api/config` now filters incoming `permissions.tools` keys against the canonical `ALL_TOOLS` set; an attacker can no longer plant a key for a future tool that doesn't yet ship.
- **Rate-limit LRU eviction** — bucket eviction switched from insertion-order to LRU by most-recent activity. Blocks the "rotate fake keys to force out legitimate clients" DoS-of-DoS pattern.
- **Folder allowlist fail-closed** — folder-scoped tools without a recognized folder argument now hit a `false` decision instead of being silently allowed. `FOLDER_AGNOSTIC_TOOLS` enumerates the tools that legitimately operate without a folder.
- **`sanitizeData()` recursion bounded** — logger sanitisation now caps at depth 100 with a `[depth-limit]` placeholder. Defeats stack-blow / CPU-burn via adversarial deeply-nested JSON.
- **State parameter length-capped** — OAuth `state` rejected if >500 chars (both GET and POST authorize).
- **Escalation reason log injection** — the audit log now records the same sanitized reason that's persisted to the pending file (control chars stripped, capped at 500). Agent-supplied `\r\n` can no longer inject fake JSONL lines.
- **SSE field sanitisation** — `event:` and `id:` SSE frame fields now strip `\r\n` before writing.
- **`credentialStorage` derived from observed state** — the badge in the settings UI is now computed from the actual presence of encrypted blobs / plaintext creds; a forged value in the config file can no longer hide plaintext-on-disk storage.
- **Dependency** — `qs` 6.15.0 → 6.15.2 via `npm audit fix` (GHSA-q8mj-m7cp-5q26 DoS).

## [3.0.22] — 2026-05-26

### Security
- **`safeConfig` credential leak** — `simpleloginApiKey` and `passAccessToken` are now redacted to `"••••••••"` before `GET /api/config` is sent to the browser. Previously both were returned in plaintext alongside `password`/`smtpToken`.
- **SSRF via `simpleloginBaseUrl`** — `validUrl` now enforces `http:`/`https:` scheme only. `file://`, `javascript:`, `ftp://`, and internal network addresses are rejected with HTTP 400 at save time.

### Fixed
- **SimpleLogin / Pass token revocation** — clearing the API key or PAT field in Settings and clicking Save now removes the stored value. Previously the truthy guard blocked empty-string writes, making revocation impossible from the UI.
- **Whitespace in pasted tokens** — `simpleloginApiKey` and `passAccessToken` are now `.trim()`'d before storage, preventing silent 401 failures from clipboard-pasted keys with trailing newlines.
- **`bulk_delete_emails` / `bulk_delete` performance** — replaced per-email loop with `imapService.bulkDeleteEmails()` (single batched IMAP UID STORE). Closes #120.
- **`bulk_move_emails` performance** — replaced per-email loop with `imapService.bulkMoveEmails()` (single batched IMAP UID COPY + expunge). Closes #120.
- **`sendProgress` restored** — `bulk_delete_emails` and `bulk_move_emails` now emit a completion progress notification when a `progressToken` is provided, honouring the documented contract.
- **Silent success on invalid email IDs** — if all IDs in a bulk call fail the numeric-UID filter, the handler now throws `InvalidParams` instead of returning `{success:0, failed:0, errors:[]}`.
- **`remoteMode` silent stdio fallback** — if `remoteMode` is set in config but no bearer token or OAuth credentials are configured, the server now exits with a clear error message instead of silently falling back to stdio (which caused invisible hangs under NSSM/systemd).
- **`settingsPort` out-of-range silent no-op** — values outside 1–65535 now return HTTP 400; previously the assignment was silently skipped.
- **`settingsPort` falsy-zero** — `parseInt(port) || 8765` replaced with `isNaN(p) ? 8765 : p` so port `0` is passed to the server for proper rejection rather than silently substituted.

### Added
- **`--no-tray` / `--no-settings-ui` CLI flags** — the `mailpouch` binary now accepts these flags for headless service deployments (NSSM, systemd) where no display is available. Partially addresses #119.

## [3.0.21] — 2026-05-08

### Added
- **Optional Integrations UI** — Settings → Setup tab now has a dedicated "Optional Integrations" card for SimpleLogin API key / base URL and Proton Pass PAT / CLI path. Previously these could only be set by editing `~/.mailpouch.json` directly.
- **Desktop notifications toggle** — Settings → Setup tab toggle to enable/disable native OS notifications for agent permission requests (default on). Previously the field existed in config but had no UI control.
- **HELP.md** — new comprehensive task-oriented help guide covering all features, configuration, and troubleshooting.
- **docs/index.md** — full documentation index with feature map.

### Fixed
- Settings UI → agent setup JSON (`/api/agent-setup`) was hardcoding port `8766` in the `settingsUi` URL instead of the actual running port.

## [3.0.17] — 2026-05-08

### Changed
- **Permission presets redesigned** — presets now follow a clear tiered model:
  - **Read-Only**: reading/analytics/system unlimited; all writes blocked
  - **Send-Only**: reading unlimited; send/forward/schedule 50/hr, `remind_if_no_reply` 100/hr; actions, deletion, folder writes, and bulk ops disabled; `sync_emails` and `get_contacts` added
  - **Supervised**: reading unlimited (no rate limits on read ops); sending 200/hr, `schedule_email` 100/hr, bulk actions 100/hr, deletion 20/hr, folder delete 20/hr, folder create/rename 100/hr, alias create 50/hr, alias delete 20/hr, server lifecycle 5/hr
  - **Full Access**: all tools, no limits (description now uses dynamic tool count)
- **Docs and help text updated** — README, README_FIRST_AI, SECURITY, TUI preset descriptions, loader comment block, and Settings UI wizard/table text all reflect new values

### Fixed
- `schedule_email` was missing its rate limit in Supervised (it's in the drafts category, not sending)
- Folder write tools (`create_folder`, `delete_folder`, `rename_folder`) had no rate limits in Supervised
- Full Access description hardcoded "47 tools" — now renders `ALL_TOOLS.length` dynamically
- Test assertions updated to match new Supervised rate limits

## [3.0.12] — 2026-05-01

### Fixed
- **Graceful update/restart lifecycle** — `POST /api/install-update` now triggers an automatic process restart after a successful npm install; tray icon is torn down and the settings web UI restarts cleanly in the new process. Browser polls `/api/status` and reloads when the server is back.
- **`restart_server` MCP tool** — removed the detached-spawn-with-`MAILPOUCH_RESPAWN` pattern that was leaving a zombie process with no tray and no settings UI. Now simply calls graceful shutdown; the MCP client reconnects and spawns a clean process with tray and settings server.
- **Standalone `mailpouch-settings` self-restart** — passing `--update` via the settings UI now tears down the tray before respawning, preventing duplicate icons.

## [3.0.11] — 2026-05-01

### Fixed
- `stripHtml`: decode `&amp;` last to prevent double-unescaping (`&amp;lt;` → `&lt;`, not `<`).

### Test
- Raise `tryGenerateSelfSignedCert` test timeout to 20 s to fix flaky Windows CI.

## [3.0.10] — 2026-05-01

### Chore
- Version bump and README badge sync.

## [3.0.9] — 2026-05-01

### Security
- **AES-256-GCM encrypted credential storage** — replaces broken OS keychain
  integration with encrypted-at-rest credentials stored directly in the config
  file. Key derived from `SHA256(hostname|salt|platform)` using Node.js built-in
  `crypto` only (no new dependencies). Credential priority chain on load:
  keychain → encrypted-file → plaintext (legacy migration). Existing plaintext
  passwords auto-migrate to encrypted-file on next startup when keychain is
  unavailable. `credentialStorage` field gains `"encrypted-file"` value;
  settings UI badge updated accordingly. Encrypted blobs never sent to the
  browser — `safeConfig()` strips them before responding.

### Added
- **Password visibility toggle** — all password and SMTP-token inputs now have
  an eye-icon button that switches between masked and visible. On page load the
  fields are blank (no placeholder ciphertext injected); clicking the eye simply
  reveals whatever the user has typed.

## [3.0.8] — 2026-05-01

### Security
- **`delete_folder` added to `DESTRUCTIVE_TOOLS`** — the tool had
  `destructiveHint: true` in its annotations but was missing from the
  confirmation-gate set, allowing a single unconfirmed call to permanently
  delete a folder and all its emails. Now requires `{ confirmed: true }` or
  MCP elicitation like `delete_email`.

### Fixed
- **`better-sqlite3` promoted to hard dependency** — moved from
  `optionalDependencies` to `dependencies`. FTS is a core feature; a missing
  native binding now surfaces immediately at the first FTS call rather than
  producing a silent degraded state.
- **FTS rebuild race condition** — concurrent `fts_rebuild` calls could
  interleave `clear()` and `upsertMany()`, leaving the index empty mid-rebuild.
  A module-level `_ftsRebuilding` flag returns `isError: true` immediately to
  any second caller.
- **`loadConfig()` per-call file reads eliminated** — was reading and parsing
  `~/.mailpouch.json` from disk on every tool dispatch. Now cached with a 15 s
  TTL; the cache is invalidated immediately on `saveConfig()` and detects
  external edits via mtime on the next TTL boundary.
- **Analytics `storageUsedMB` crash** (`body?.length ?? 0`) — `trimForAnalytics()`
  sets `body: undefined`; `get_email_stats` accessed `email.body.length`
  unconditionally. Harness test now asserts all numeric stat fields are present
  and non-negative.

## [3.0.7] — 2026-05-01

### Fixed
- **README accuracy audit** — corrected six stale or false claims: `any`
  annotation count, wizard step 3 label ("Credentials" → "Account"), keychain
  storage scope (Bridge password + SMTP token only), missing Accounts and
  Agents tabs in settings UI description, SMTP backoff code `451` → `454`.
- **`src/utils/tray.ts` comment** — updated committed prebuilt count from 4 to
  5 now that `linux-arm64-gnu` is built and shipped.

## [3.0.6] — 2026-05-01

### Fixed
- **Node 25 TLS SNI breakage on SMTP and IMAP** — Node 25 rejects IP literals
  as the TLS `servername` before `checkServerIdentity` runs. Extracted a shared
  `buildBridgeTlsOptions()` helper (`src/services/bridge-tls.ts`) that sets
  `servername: "localhost"` on all three Bridge TLS option blocks (SMTP +
  IMAP primary connect + IMAP idle reconnect). Four new unit tests added
  (`bridge-tls.test.ts`). Closes / expands on #104.
- **ReDoS in HTTP Bearer token regex** — greedy `.+` in
  `src/transports/http.ts` replaced with `\S+` on a pre-trimmed string.
- **`nodemailer` bumped** from `~8.0.2` → `~8.0.7` (#108) — picks up upstream
  CVE fixes.
- **aarch64 cross-compile CI** — Ubuntu 24 Noble split `libglib2.0-dev-bin`
  into two `Architecture: all` packages; added both as a pre-install step so
  the arm64 cross-dependency chain resolves cleanly.
- **Stale `glib` direct dependency removed** from `native/tray/Cargo.toml` —
  only `gtk` APIs are called; the explicit `glib = "0.18"` was unused and
  triggered a Dependabot alert.

### Changed
- **CI matrix** — dropped `macos-13` (GitHub retired the Intel hosted runner
  pool; jobs were queuing indefinitely). `macos-latest` (arm64) retained.
- **Dependabot / vitest** bumped `vitest` and `@vitest/coverage-v8` from
  4.1.4 → 4.1.5 (#105, #106).

## [3.0.5] — 2026-04-20

### Fixed
- **Update check now works in all GUI MCP client environments** (#102). The
  previous fix (#101) resolved the `npm` binary path, but `npm` is itself a
  shell script (`#!/usr/bin/env node`) that still needs `node` on `PATH`.
  Both `/api/check-update` and `/api/install-update` now inject
  `path.dirname(process.execPath)` at the front of the child process `PATH`
  so npm can always find its own Node runtime regardless of what the parent
  client passes.

## [3.0.4] — 2026-04-20

### Fixed
- **Volume trends bucket count was off by one near DST transitions** (#). The
  `calculateVolumeTrends` implementation used `setDate`/`getDate` (local time)
  to build bucket keys but `toISOString()` for the key string (UTC). Across a
  daylight-saving transition two adjacent local calendar days could produce the
  same UTC ISO date, collapsing 365 buckets to 364. Switched to pure UTC
  arithmetic (`Date.UTC` + ms-per-day offset) which is DST-safe and always
  produces exactly the requested number of buckets.

## [3.0.3] — 2026-04-20

### Fixed
- **Update check no longer fails with `spawn npm ENOENT`** (#101). The
  `/api/check-update` and `/api/install-update` settings endpoints called
  `spawn("npm", ...)` which fails when `PATH` is stripped by GUI MCP
  clients (Claude Desktop, VS Code). Both now derive the npm binary path
  from `path.dirname(process.execPath)` — npm is always co-located with
  the running node binary.

### Changed
- `imapflow` bumped from 1.3.1 → 1.3.2 (#100).
- CI: `actions/setup-node` bumped from v5 → v6 (#99).
- CI: `actions/upload-artifact` bumped from v4 → v7 (#98).

## [3.0.2] — 2026-04-20

### Fixed
- **Duplicate tray icons when cowork spawns multiple MCP subprocesses** (#97).
  Each MCP process called `_initTray()` independently, producing one icon per
  process. The first process to bind the settings port now owns the tray;
  subsequent processes detect `_settingsExternal = true` and skip tray init.

## [3.0.1] — 2026-04-20

### Fixed
- **Tray icon now appears when launched by GUI MCP clients** (#95). Claude
  Desktop and VS Code strip `DISPLAY` / `WAYLAND_DISPLAY` when spawning
  stdio subprocesses; the tray precondition check bailed with "no display
  environment" even on graphical hosts. Added `inheritDisplayFromParent()`
  which reads `/proc/<ppid>/environ` on Linux and copies the display vars
  into `process.env` before tray init. Also migrated the MCP's `_initTray()`
  from direct `systray2` usage to the shared `createTray()` facade so it
  picks the native tauri `tray-icon` backend on GNOME instead of the
  broken systray2 path (same facade the standalone `mailpouch-settings`
  daemon already used).
- Stale hardcoded `"2.2.0"` version literal in the `/agent-setup` JSON
  output — now derived from `package.json` like the MCP `serverInfo.version`,
  so agents always see the actual running version.

## [3.0.0] — 2026-04-20

### Security
- **Per-account Bridge passwords now route through the OS keychain on every
  save path** (#93). The Accounts-tab CRUD endpoints previously wrote
  plaintext passwords into `~/.mailpouch.json`; they now store them under
  `bridge-password:<acct-id>` / `smtp-token:<acct-id>` keychain entries
  (same `mailpouch` service name as the legacy single-account key) and
  scrub the on-disk JSON. Legacy installs with the suffix-less
  `bridge-password` key continue to work via a back-compat read path.
  The in-memory `AccountManager` is also refreshed on every save so the
  MCP reconnects immediately — no restart needed.
- CSRF session-expired responses carry a machine-readable `code:
  "session_expired"` and the settings-UI JS auto-reloads the page on
  403 instead of surfacing the cryptic raw error (#82).

### Added
- **Native system-tray binding** (`native/tray/`) via napi-rs around the
  `tauri-apps/tray-icon` Rust crate — the same crate Tauri ships in
  production. Renders correctly on modern GNOME, NSStatusBar, and
  Shell_NotifyIcon; replaces the `systray2` Go binary wherever a
  prebuilt is available. systray2 stays as a fallback on platforms
  without a committed prebuilt yet. (#88, #89, #90, #91, #92)
- Prebuilts for linux-x64-gnu, linux-arm64-gnu, darwin-arm64,
  win32-x64-msvc, and win32-arm64-msvc. darwin-x64 (Intel Mac) falls
  back to systray2 cleanly (the GNOME rendering bug doesn't affect
  macOS). CI workflow `.github/workflows/build-native-tray.yml`
  produces prebuilts for the full 6-target matrix on every push.
- Brand-matching tray icon generator (`src/utils/icon.ts`): 64×64 base
  with a `#6D4AFF` → `#9B6DFF` gradient + rounded corners, matching
  the settings-UI `.logo-icon` CSS byte-for-byte. Windows ICO packs
  16/32/48/64 sub-sizes for hi-DPI sharpness. (#88)
- **Persistent tray via `mailpouch-settings`** — the standalone
  entry point now carries its own tray icon for its lifetime. Users
  add it to their OS autostart (systemd user unit / LaunchAgent /
  Windows Startup folder) and get a tray that stays resident so
  clicking "Open Settings" anytime brings the UI back. The MCP's
  embedded tray coexists via a probe-then-reuse check (#86, #89).
- Bridge cert auto-detect + file-picker upload in the settings UI
  — every cert-path field on the Setup tab, first-run wizard, and
  Accounts form gets a **Detect** button (scans `~/Downloads`,
  `~/Documents`, `~/Desktop`, `~/`, and Bridge's per-OS in-place
  location) and a **📁 Browse** button (native file picker → POST
  to new `/api/upload-bridge-cert` → written to
  `~/.mailpouch-bridge-cert.pem` at mode 0600). No manual path
  typing required. (#83)
- `/api/search-bridge` now falls back to `which proton-bridge /
  protonmail-bridge / bridge` on POSIX when the hardcoded
  candidate list misses — catches Debian/Ubuntu's
  `/usr/bin/protonmail-bridge` and Homebrew/AUR/Flatpak installs.
  (#83)

### Changed
- `SMTPService` constructor no longer throws when the configured
  Bridge cert path is unreachable — the error is deferred to the
  first `sendEmail()` / `verifyConnection()` call. Previously a
  stale or wrong `bridgeCertPath` crashed the MCP at module load,
  before stdio came up, leaving no way to surface a structured
  error to the client. The new `SMTPService.initError` field
  carries the actionable message and `get_connection_status` now
  surfaces it in the `smtp.initError` response field. (#84)
- `AccountManager` gains `rebuildFromRegistryAsync()` + an
  `applyKeychainCredentials(password, smtpToken?)` method that
  the boot path and settings-save endpoints use to push fresh
  credentials into the per-account SMTP/IMAP services without
  an MCP restart. Closes a regression introduced by the
  multi-account registry rollout where keychain-stored
  credentials were never propagated to per-account services.
  (#87, #93)
- Settings-UI startup now **probes the configured port for an
  existing mailpouch instance** before retrying the bind. When a
  standalone `mailpouch-settings` daemon is already listening, the
  MCP logs "Reusing existing Settings UI at …" and silently shares
  the port instead of emitting a four-retry WARN cycle. Non-
  mailpouch listeners still get the actionable "another process is
  using this port" warning. (#86)

### Fixed
- Six detached-spawn sites (`.unref()` without a matching
  `.on('error', …)` listener) hardened against `ENOENT` crashes on
  hosts missing a target binary — including the "Restart Claude
  Desktop" tray action that previously took the settings server
  down on Linux (no Linux build of Claude Desktop exists). (#82)
- Platform-aware Claude-Desktop detection via `existsSync` on
  `/Applications/Claude.app`, `%LOCALAPPDATA%\AnthropicClaude\...`,
  etc.; returns a structured `{ok:false, error:…}` response when the
  binary isn't installed instead of crashing. (#82)
- `loadConfig()` preserves `settingsPort` and `credentialStorage`
  fields across load/save round-trips. The Settings-UI port field
  was previously reverting to `8765` after every save even though
  the intended value had persisted to disk; the read path was
  silently dropping top-level fields. Validation mirrors the
  `POST /api/config` merge path (`Math.round` → `[1, 65535]` range
  check). (#85)
- Tray icon click routing via napi-rs `ThreadsafeFunction` — the
  default `ErrorStrategy::CalleeHandled` invokes the JS callback
  Node-style as `(err, value)` so our `(id) => …` handler was
  receiving `null` as the first arg and silently no-op'ing every
  click. Switched to `ErrorStrategy::Fatal` so the id arrives as
  the single callback argument. (#91)

### Removed (breaking)
- Legacy env-var aliases `PM_BRIDGE_MCP_*` and `PROTONMAIL_MCP_*` — only
  `MAILPOUCH_*` is read now. Callers still setting the old names must update.
- Legacy file-path fallbacks (`~/.pm-bridge-mcp-*`, `~/.protonmail-mcp-*`)
  — the server now only reads/writes `~/.mailpouch*`. Installs that never
  ran v2.2.0 must rename any `~/.pm-bridge-mcp*` / `~/.protonmail-mcp*`
  files to the matching `~/.mailpouch*` name. This covers config,
  scheduler store, reminders, log file, audit log, pending escalations,
  pass audit, FTS database, and agent grants/audit files. (#80)
- One-shot keychain migration from `protonmail-mcp-server` / `pm-bridge-mcp`
  service entries to `mailpouch`. Users on those legacy entries must
  re-enter their Bridge password via the settings UI. (#80)

### Test-count + housekeeping
- 1,566 → 1,588 passing tests (+22 regression tests across spawn
  hardening, cert auto-detect, SMTP deferred-init, loader round-
  trip, CSRF session-reload, icon format, tray preconditions, and
  per-account keychain scrubbing).
- 2,927 lines of stale documentation removed (autonomous-cycle
  log, point-in-time audit snapshots, pre-rename design reviews).
  (#81)

## [2.2.0] — 2026-04-18
### Changed
- **Product renamed to `mailpouch`** — the name better reflects the product's
  positioning (a sealed, private pouch for mail in transit between your
  provider and your agent). The `pm-bridge-mcp` name was descriptive but
  trademark-adjacent; `mailpouch` is era-neutral and brand-safe.
- Package name, bin names, config path, env vars, log file, webhook
  signature header, MCP server name, and OS keychain service name all
  rename in lockstep.
### Added
- **One-shot keychain migration** at startup — existing installs carry
  their stored Bridge password forward from `protonmail-mcp-server` or
  `pm-bridge-mcp` service entries to `mailpouch`. No re-entry required.
- **Legacy env-var aliases honored** through v3.0: `MAILPOUCH_X` wins,
  but `PM_BRIDGE_MCP_X` and `PROTONMAIL_MCP_X` still read.
- **Legacy file-path aliases honored**: reads fall back to
  `~/.pm-bridge-mcp-*` and `~/.protonmail-mcp-*` if the new path is
  absent. Writes always use the new path.
### Breaking
- Webhook signature header renamed `X-PMBridge-Signature-256` →
  `X-Mailpouch-Signature-256`. Downstream verifiers must update. The
  CloudEvents `source` and `type` prefix changed too (`pm-bridge-mcp` →
  `mailpouch`, `com.pmbridge.*` → `com.mailpouch.*`), and the outbound
  `User-Agent` is now `mailpouch/1 (+https://github.com/chandshy/mailpouch)`.
- Binary names changed: `pm-bridge-mcp` → `mailpouch`,
  `pm-bridge-mcp-settings` → `mailpouch-settings`.

## [2.1.0] — 2026-04-18

Adds multi-account support, per-agent permission grants, a remote HTTP
transport with OAuth 2.1, local full-text search, and integrations with
SimpleLogin and Proton Pass. The product is renamed from
`protonmail-agentic-mcp` to `pm-bridge-mcp`. Tool count: 49 → 67.

### Added

- **Multi-account registry** (#63) — `accounts[]` + `activeAccountId` in
  the config; `AccountManager` owns one `{imap, smtp, spec}` per account
  and hot-swaps the module-level service symbols on `active-changed`
  events (no restart). Per-tool routing via an `account_id` arg. Accounts
  tab in the Settings UI. Legacy single-account configs auto-migrate to a
  "primary" account.
- **Per-agent permission grants** (#63) — per-caller gate with grants
  that progress pending → active → revoked/expired. Conditions:
  `expiresAt`, `folderAllowlist`, `ipPins`, `maxCallsPerHourByTool`,
  `accountId`, `toolOverrides`. Append-only audit log (hashed args only,
  never values; 10 MB rotation, 3 compressed generations). Approve / deny
  / revoke and approve-with-conditions modal in the Agents tab.
- **Notification channels** (#63) — `DesktopNotifier` (macOS `osascript`,
  Linux `notify-send`, Windows `powershell.exe` toast; no dep).
  `WebhookDispatcher` with CloudEvents 1.0 default, Slack/Discord
  auto-detection, HMAC-signed `X-PMBridge-Signature-256`, 8-attempt
  exponential backoff with ±20 % jitter. Triggered by a
  `NotificationBroker` that emits grant-created/approved/denied/revoked/
  expired events.
- **HTTP transport with OAuth 2.1** (#53) — `StreamableHTTPServerTransport`
  in remote mode. Either static bearer (`remoteBearerToken`) or the full
  OAuth suite: `/oauth/register` (RFC 7591 DCR), `/oauth/authorize` (PKCE
  S256 consent flow gated by admin password), `/oauth/token` (RFC 8707
  resource indicator validation), `/oauth/revoke`,
  `/.well-known/oauth-authorization-server` (RFC 8414),
  `/.well-known/oauth-protected-resource` (RFC 9728). Per-caller
  token-bucket rate limit (20 req/s sustained, 40 burst; 3× bucket for
  authenticated). Stdio transport unchanged for Claude Desktop.
- **Local FTS5 search index** (#52) — three tools (`fts_search`,
  `fts_rebuild`, `fts_status`) backed by `better-sqlite3` (optional
  native dep). BM25 ranking, FTS5 syntax (phrase, boolean, prefix, column
  filters), snippet output. Graceful degradation when `better-sqlite3`
  isn't installed — `fts_status` reports `available: false`, other tools
  return `InvalidRequest`; mail tools unaffected.
- **Proton Pass integration** (#51) — three tools: `pass_list`,
  `pass_search` (both safe), `pass_get` (destructive, audit-logged).
  Subprocess wrapper around `pass-cli` with a Personal Access Token.
  Every `pass_get` call is appended to
  `~/.pm-bridge-mcp-pass-audit.jsonl` (no arg values, no response
  bodies).
- **Reminder scheduler** (#50) — `remind_if_no_reply`,
  `list_pending_reminders`, `cancel_reminder`, `check_reminders`. JSONL
  persistence at `~/.pm-bridge-mcp-reminders.json`.
- **Content tools** (#49) — `get_thread` (IMAP
  `References`/`In-Reply-To` walk with a 200-message cap) and
  `get_correspondence_profile` (volume, first/last interaction, average
  response time for a single address).
- **Progressive tool tiering** (#48) — three tiers (`core` / `extended`
  / `complete`); `PM_BRIDGE_MCP_TIER` env var and `toolTier` config
  field control how many tools appear in ListTools. Reduces context
  bloat for agents that only need a subset.
- **MCP elicitation for destructive tools** (#47) — destructive tool
  calls trigger an elicitation request to the client before executing.
  Older clients without elicitation fall back to the
  `{ confirmed: true }` argument flow (preserves the pre-elicitation
  behavior).
- **SimpleLogin alias tools** (#46) — six tools for managing aliases on
  Proton-owned SimpleLogin (optional; requires API key). `alias_delete`
  is destructive.
- **"Works best with…" companion MCP servers** (#45) — README section
  listing complementary MCP servers that pair well with pm-bridge-mcp.

### Changed

- **Product rename** (#34) — `protonmail-agentic-mcp` → `pm-bridge-mcp`.
  Config path prefers `~/.pm-bridge-mcp.json`, falls back to the legacy
  `~/.protonmail-mcp.json`. npm binary and homepage URLs updated.
- **Bridge TLS hardening** (#31) — production default now requires a
  loaded Bridge TLS cert; localhost Bridge without a cert needs explicit
  `allowInsecureBridge` opt-in (config field or
  `PROTONMAIL_MCP_INSECURE_BRIDGE=1`). Bridge version floor bumped to
  v3.22.0 (detected via IMAP ID).
- **Compliance UX** (#33) — destructive-tool confirmation gate (on by
  default; `requireDestructiveConfirm`) + ToS §2.10 acknowledgement
  recorded on first launch.
- **SMTP abuse-signal backoff** (#35) — exponential backoff (base 5 s,
  cap 5 min, with jitter) when SMTP returns 421/450/454. Prevents
  accidental hammering of Bridge after Proton rate-limits us.
- **Build tooling** — TypeScript 5.9 → 6.0 (#13),
  `moduleResolution: NodeNext` switch.

### Fixed

- **`chore(deps)`** (#62) — resolved three transitive CVEs from
  `@modelcontextprotocol/sdk@1.29.0` via `package.json` `overrides`:
  `hono >=4.12.14` (6 moderate advisories),
  `@hono/node-server >=1.19.13` (moderate), `path-to-regexp >=8.4.2`
  (high ReDoS).
- **`TOOL_CATEGORY_TIER` gap** — the `aliases` category was missing from
  the tier map after #46 and #48 interleaved on main, leaving alias
  tools unreachable from `toolsForTier("complete")`. Fixed while
  rebasing #49.

### Dependency bumps (Dependabot)

- `@modelcontextprotocol/sdk` 1.27.1 → 1.29.0 (#19)
- `imapflow` 1.2.15 → 1.3.1 (#25)
- `mailparser` 3.9.4 → 3.9.8 (#27)
- `@types/nodemailer` 6.4.19 → 8.0.0
- `@types/node` 25.5.0 → 25.6.0 (#26)
- `vitest` 4.1.0 → 4.1.4 (#30)
- `@vitest/coverage-v8` 4.1.0 → 4.1.4 (#28)

### Coverage notes

- Test count: 1,021 → **1,525** across 41 files.
- Thresholds relaxed as new subsystems brought defensive error paths
  that are hard to exercise without stubbing native deps: statements
  95 → 94, branches 94 → 90, functions 94 → 93, lines 96 → 96.
  Backfilling these is a follow-up.

## [2.0.4] — 2026-03-19

### Improved

- **Test coverage** — 1,251 tests passing across 21 test files; branch coverage raised from ~84% to **95.4%** (threshold enforced at 95%); line coverage **96.3%**; `escalation.ts` and `analytics-service.ts` now at **100% branch coverage**
- **Coverage thresholds** — Vitest enforces statements ≥ 95%, branches ≥ 95%, functions ≥ 94%, lines ≥ 96%
- New test patterns: async-generator UID scan mocks, per-test `simpleParser` overrides, module-level `fs`/`os`/`imapflow`/`mailparser` mocks in isolated files

## Autonomous Improvement Cycles #1–#48 (2026-03-18)

### Security

- **`tray.ts` systray2 types** — ambient module declaration added (`src/types/systray2.d.ts`); all `any` type annotations in `tray.ts` replaced with proper types from the ambient module (`SysTrayConstructor`, `MenuItem`, `InstanceType<SysTrayConstructor>`); zero `any` type annotations remain anywhere in production TypeScript source (Cycle #43)
- **Email cache byte-size limit** — `MAX_EMAIL_CACHE_BYTES = 50 MB` enforced alongside the existing 500-entry count cap; `cacheByteEstimate` counter maintained; `evictCacheEntry()` / `clearCacheAll()` helpers ensure all 11 mutation sites update the counter atomically (Cycle #42)
- **`body` JSON parsers in settings server** typed as `Record<string, unknown>` instead of `any`; `permissions.preset` now validated against `PERMISSION_PRESETS` before assignment; credential spreads require `typeof === "string"` guard (Cycle #41)
- **IMAP search boolean flags** — `isStarred: false` was previously a no-op (unanswered/undraft fields silently ignored by imapflow); fixed to use `SearchObject` boolean API — `seen`/`answered`/`draft` now correctly pass `false` as "not set" (Cycle #40, bug fix)
- **`search_emails` multi-folder `folders[]`** — each entry now validated via `validateTargetFolder()` to prevent path traversal; service-level `validateFolderName()` also now checks for `..` sequences as defence-in-depth (Cycle #22)
- **`cancel_scheduled_email`** — UUID format guard added; non-UUID `id` values now return `McpError(InvalidParams)` (Cycle #22)
- **Settings UI HTML response** — added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Cache-Control` headers (Cycle #22)
- **`send_email` / `forward_email` / `reply_to_email`** — missing empty-string guard on required string fields added; empty `to`, `body` now return `McpError(InvalidParams)` instead of propagating to SMTP (Cycles #23–#24)
- **Bulk operations** — empty `emailIds` array now rejected with `McpError(InvalidParams)` rather than silently returning zero-result success (Cycle #23)
- **`saveDraft` `inReplyTo`** CRLF/NUL stripping added to IMAP path — previously only stripped in SMTP path; crafted `inReplyTo` values with `\r\n` could inject MIME headers (Cycle #28)
- **`forward_email` subject** capped at 998 chars (RFC 2822) matching all other send handlers (Cycle #29)
- **`rename_folder`** — same-name guard added; identical old/new name now returns `McpError(InvalidParams)` instead of issuing a spurious IMAP RENAME (Cycle #29)
- **`send_email` / `schedule_email` `replyTo`** validated via `isValidEmail()` at handler entry (Cycle #30)
- **Body max-length cap** (10 MB) added to `send_email`, `save_draft`, `schedule_email`, `reply_to_email`, `forward_email` (Cycles #33–#34)
- **`wipeString()` / `wipeObject()`** in `src/security/memory.ts` typed as `Record<string, unknown>` (was `any`) (Cycle #41)
- **Path traversal prevention** — `get_emails_by_label`, `move_to_folder`, `remove_label`, `bulk_remove_label` now validate label/folder args via `validateLabelName()` / `validateTargetFolder()` before use in IMAP paths (Cycle #1)
- **`decodeCursor` folder field** now validated via `validateTargetFolder()` — crafted cursors with traversal paths (e.g. `../../etc`) are rejected as invalid (Cycle #5)
- **`save_draft` attachment sanitization** — filename stripped of CRLF/NUL and truncated to 255 chars; contentType validated against type/subtype regex before MIME construction (Cycle #9)
- **`validateAttachments()` helper** added to `src/utils/helpers.ts`; called in `send_email`, `save_draft`, and `schedule_email` handlers — malformed attachment arrays now raise `McpError(InvalidParams)` at the handler boundary rather than propagating to nodemailer (Cycle #15)
- **`search_emails` free-text fields** (`from`, `to`, `subject`) capped at 500 characters to prevent oversized IMAP SEARCH commands (Cycle #6)
- **`move_email` / `bulk_move_emails`** now call `validateTargetFolder()` before IMAP move (Cycle #3)
- **`send_test_email`** validates recipient address via `isValidEmail()` at handler entry (Cycle #3)
- **`create_folder` / `delete_folder` / `rename_folder`** now call `validateFolderName()` at handler entry (Cycle #7)
- **`mark_email_read` / `star_email` / `move_to_label` / `remove_label`** now enforce numeric-only emailId guard (Cycles #7, #9)

### Added

- **`SimpleIMAPService.healthCheck()`** — NOOP-based live connection probe; returns `true`/`false`, never throws (Cycle #13)
- **`imap.healthy` field** in `get_connection_status` response — surfaces the NOOP probe result to agents (Cycle #14)
- **`requireNumericEmailId()` helper** in `src/utils/helpers.ts` — DRY extraction of the numeric-UID guard used across 12+ handlers (Cycle #13)
- **JSDoc coverage** — 14 public methods across `SimpleIMAPService` and `SmtpService` now documented (Cycle #11)
- **`validateAttachments()` helper** with 23 unit tests (Cycle #15)

### Changed

- **Type safety milestone (Cycles #37–#43)** — all `catch (e: any)` blocks replaced with `catch (e: unknown)` across entire codebase; `SearchObject` imported from imapflow replacing hand-rolled `ImapSearchCriteria`; `SendMailOptions` from nodemailer replacing `mailOptions: any`; `ImapBodyNode` interface for bodyStructure traversal; `body: any` JSON parsers in settings server replaced with `Record<string, unknown>`; `wipeString/wipeObject` parameters tightened; `tray.ts` fully typed via systray2 ambient module. Zero `any` catch blocks or avoidable `any` type annotations remain anywhere in production source.
- **Email cache dual-eviction policy** — `setCacheEntry()` now evicts on BOTH entry count (500) AND byte size (50 MB); prevents unbounded memory growth with very large email bodies (Cycle #42)
- **Parameter type guards** — comprehensive runtime type checks added across all 47 tool handlers for string, number, boolean, array, and enum fields; all guards throw `McpError(InvalidParams)` with actionable messages (Cycles #20–#36)
- **`imapSecure` flag** added to IMAP connection config (Cycle #21, implicit TLS support)
- **Type safety** — 9 avoidable `as any` casts removed from `src/index.ts`, `analytics-service.ts`, and `simple-imap-service.ts`; `AppendResult` local interface introduced to replace `(result as any).uid`; all production `as any` casts eliminated (Cycles #10–#12)
- **`move_to_label` / `bulk_move_to_label`** inline validation replaced with `validateLabelName()` helper calls (Cycle #14)
- **`SchedulerService.pruneHistory()`** added — drops non-pending records older than 30 days and caps list at 1 000 entries on load (Cycle #2)
- **`Analytics.getEmailStats()`** — `Math.min/max(...dates)` spread replaced with `reduce` pattern to avoid stack overflow on large arrays (Cycle #2)
- **`parseEmails()`** now logs a `warn` for each dropped invalid address instead of silently discarding (Cycle #3)
- **`sendTestEmail` body** uses plain ASCII — removed emoji from subject and body (Cycle #4)

### Fixed

- **IMAP `isStarred: false` search** — was silently ignored (imapflow non-existent `unflagged` field); now correctly passes `flagged: false` (Cycle #40)
- **`search_emails` date cross-validation** — `dateFrom > dateTo` now returns `McpError(InvalidParams)` instead of silently returning zero results (Cycle #25)
- **Test suite** — 854 tests pass (was 212 before Cycle #1); +642 tests added across Cycles #1–#43 covering all new validation paths, helpers, security guards, and cache byte-limit behaviour

### Added (Cycles #44–#48)

- **`list_proton_scheduled` tool** — reads the "All Scheduled" IMAP folder exposed by Proton Bridge to list emails natively scheduled via the Proton Mail web or mobile app; distinct from MCP-scheduled emails managed by `schedule_email` (tool count raised to 48)
- **folderCache TTL** — `getFolders()` returns cached data within a 5-minute TTL without an IMAP round-trip; `clearFolderCache()` helper resets the cache at all 5 mutation sites; 7 new tests (Cycle #44)
- **Vitest coverage thresholds** — statement/branch/function/line floors enforced in `vitest.config.ts`; raised progressively from 45/38/50/47 through to 62/54/72/63 across Cycles #44–#48 (Cycles #44, #47, #48)

### Changed (Cycles #44–#48)

- **Test count: 854 → 1,021** — +167 tests added across Cycles #44–#48 covering utils (helpers, logger, tracer), analytics, scheduler, escalation, settings/security, and folder-cache TTL (Cycles #44–#48)
- **`diagnosticErrorMessage` cast narrowed** — `error as any` replaced with `error as {code?: unknown; command?: unknown; responseCode?: unknown}` in `src/index.ts` (Cycle #45)
- **`get_logs` `level` parameter** — added `typeof !== "string"` type guard; non-string values now return `McpError(InvalidParams)` instead of silently falling back to all levels (Cycle #46)
- **MCP prompt handler hardening** — `triage_inbox` NaN limit guard + clamp to 1–100; `thread_summary` prompt now calls `requireNumericEmailId()` to prevent prompt injection via crafted `emailId`; `find_subscriptions` prompt now calls `validateTargetFolder()` to prevent prompt injection via crafted folder path (Cycle #46)
- **Coverage milestones** — `helpers.ts`, `logger.ts`, `tracer.ts`: 100%/100%/100%/100%; `analytics-service.ts`: 99%/99%/98%/100%; `escalation.ts`: 89%/78%/100%/99%; `scheduler.ts`: 92%/84%/90%/99%; `settings/security.ts`: 78%/78%/85%/79% (Cycles #47–#48)

### Documentation (Cycles #44–#48)

- **README** — rebuilt from scratch: corrected tool count from 47 to 48, fixed binary names (`protonmail-agentic-mcp-settings` not `protonmail-mcp-settings`), added `list_proton_scheduled`, `delete_folder` to folder tools table, updated MCP SDK badge to 1.27+, updated test count badge to 1,021 (Cycle #48 docs pass)
- **README_FIRST_AI.md** — added `triage_inbox` and `daily_briefing` to MCP Prompts section; added `list_proton_scheduled` to tool reference (Cycle #48 docs pass)

### Documentation (Cycles #1–#43)

- **README** — corrected tool count from 45 to 47 in tagline and Full Access preset description (Cycle #16)
- **README MCP Prompts** — expanded from 3-item list to full 5-row table covering all registered prompts: `compose_reply`, `thread_summary`, `find_subscriptions`, `triage_inbox`, `daily_briefing` (Cycle #17)
- **Settings UI** — corrected stale "40 tools" to "47 tools" in two locations within the embedded HTML (preset comparison table and setup wizard card) (Cycle #17)
- **`get_connection_status` outputSchema** — added 6 missing fields: `smtp.lastCheck`, `smtp.insecureTls`, `smtp.error`, `imap.insecureTls`, `settingsConfigured`, `settingsConfigPath` (Cycle #18)
- **`list_scheduled_emails` outputSchema** — added missing `retryCount` field to item properties (Cycle #18)
- **`get_email_analytics` outputSchema** — expanded 4 bare `{type:"object"}` entries (`topSenders`, `topRecipients`, `peakActivityHours`, `attachmentStats`) to full typed schemas matching the `EmailAnalytics` interface (Cycle #19)
- **`get_contacts` outputSchema** — added 4 missing `Contact` interface fields: `name`, `firstInteraction`, `averageResponseTime`, `isFavorite` (Cycle #19)

## [2.1.0] - 2026-03-17

### Added
- **5 new tools** (47 total): `save_draft`, `schedule_email`, `list_scheduled_emails`, `cancel_scheduled_email`, `download_attachment`
- `save_draft` — IMAP APPEND to Drafts folder; returns server-assigned UID
- `schedule_email` — queue email for delivery at a future time (60 s – 30 days); survives restarts
- `list_scheduled_emails` — list all scheduled emails with status and retry count
- `cancel_scheduled_email` — cancel a pending scheduled email by ID
- `download_attachment` — retrieve attachment content as base64 from cached email
- Retry logic for scheduled emails (up to 3 attempts before marking permanently failed)
- `--help` / `--version` flags for `npm run settings` entry point
- `insecureTls` field on `get_connection_status` SMTP and IMAP sub-objects — agents can now detect degraded TLS

### Changed
- `EmailMessage.headers` type widened to `Record<string, string | string[]>` (RFC 5322 multi-value headers)
- `ScheduledEmail` interface gains optional `retryCount` field
- `PERMISSION_PRESETS` is now an exported const in `schema.ts`; `loader.ts` and `security.ts` derive their valid-preset sets from it
- `settings-main.ts` validates `PROTONMAIL_MCP_CONFIG` env var stays within the home directory

### Security
- TLS cert-missing and cert-load-failure paths now log at `error` level (previously `warn`) and set `insecureTls = true` on the service instance — surface via `get_connection_status`
- Escalation `approveEscalation()` now re-checks expiry after finding the record (prevents TOCTOU race)
- Escalation `reason` field now strips ANSI/C0/C1 control codes before storage
- Scheduler `load()` validates each record's shape — malformed entries are skipped with a warning rather than poisoning the in-memory list
- Scheduler `persist()` uses atomic temp-file + rename to prevent partial writes
- Rate-limit denials now logged at `warn` level (previously silent)
- Logger sanitizer updated from `[\r\n\t]` to full C0/C1 range `[\x00-\x1f\x7f]`
- IMAP search strings (`from`, `to`, `subject`) sanitized against `"` and `\` to prevent SEARCH injection
- `dateFrom` / `dateTo` search parameters validated with `isNaN(Date.parse(...))` before use
- `references` items in `saveDraft` stripped of C0/C1 control characters
- Analytics cache now uses an in-flight promise to collapse concurrent stampede fetches
- Redundant per-tool `permissions.check()` calls removed from `save_draft` and `schedule_email` (already enforced centrally)
- Duplicate `'drafts'` entry removed from `pickDraftsFolder` fallback list

## [2.0.0] - 2026-03-17

### Added
- **40 tools** (up from 20 in v1.0.0) with structured output and MCP annotations
- **Permission system** with 4 presets: read_only (default), supervised, send_only, full
- **Per-tool rate limiting** with configurable limits per preset
- **Human-gated escalation system** — two-channel design with CSRF protection, 5-minute expiry, audit trail
- **Browser-based settings UI** at localhost:8765 with setup wizard, permissions, escalations, and status tabs
- **Terminal UI (TUI)** with auto-detection of environment capabilities
- **MCP Resources** — `email://` and `folder://` URI schemes for addressable data
- **MCP Prompts** — compose_reply, thread_summary, find_subscriptions workflow templates
- **Cursor-based pagination** for stable pagination across mailbox mutations
- **Progress notifications** for bulk operations (bulk_move, bulk_delete, bulk_move_to_label)
- **Tool annotations** — readOnlyHint, destructiveHint, idempotentHint on all tools

#### New Tools
- `get_unread_count` — fast per-folder unread count without fetching emails
- `reply_to_email` — threaded replies with proper In-Reply-To/References headers
- `archive_email` — convenience wrapper to move to Archive
- `move_to_label` — move email to Labels/ folder
- `bulk_move_to_label` — bulk move to label with progress notifications
- `bulk_move_emails` — bulk move with progress notifications
- `bulk_delete_emails` — bulk delete with progress notifications
- `request_permission_escalation` — agent requests temporary elevated permissions
- `check_escalation_status` — poll pending escalation status
- `sync_folders` — refresh folder list from IMAP server

### Changed
- Tool descriptions rewritten for agent token efficiency (no emojis)
- All tool responses now include `structuredContent` + `outputSchema`
- Config stored in `~/.protonmail-mcp.json` with mode 0600 and atomic writes
- `add_label` renamed to `move_to_label` for accurate semantics

### Security
- 10-layer defense-in-depth security model
- CSRF protection on all mutating settings API calls
- Origin/Referer validation on settings server
- Input sanitization (email addresses, folder names, attachment sizes, hostnames)
- CRLF injection prevention in SMTP headers
- Email cache capped at 500 entries, rate-limiter buckets capped at 10k
- Append-only audit log at `~/.protonmail-mcp.audit.jsonl`

## [1.0.0] - 2025-10-22

### Added
- Initial release of ProtonMail MCP Server
- Complete MCP server implementation with 20 tools
- SMTP email sending via ProtonMail with Nodemailer
- IMAP email reading via Proton Bridge with ImapFlow
- Advanced email analytics and statistics
- Email folder management and synchronization
- Email search with advanced filtering
- Contact interaction tracking
- Email volume trends analysis
- System logging and debugging tools
- Comprehensive documentation and examples
- Support for IPv4/IPv6 connections
- Self-signed certificate handling for Proton Bridge
- Environment variable configuration
- TypeScript implementation with full type safety

### Features

#### Email Sending
- Rich HTML/Text email composition
- Multiple recipients (TO, CC, BCC)
- File attachments with base64 encoding
- Priority levels and custom headers
- Custom reply-to addresses
- SMTP connection verification

#### Email Reading
- Full folder synchronization
- Advanced email search
- Message parsing and threading
- Attachment handling
- Read/unread status management
- Star/flag operations
- Email moving and organization

#### Analytics
- Email volume trends
- Contact interaction statistics
- Response time analysis
- Communication insights
- Storage usage tracking

#### System
- Connection status monitoring
- Cache management
- Comprehensive logging
- Error tracking and recovery

[2.0.0]: https://github.com/chandshy/protonmail-mcp-server/releases/tag/v2.0.0
[1.0.0]: https://github.com/chandshy/protonmail-mcp-server/releases/tag/v1.0.0
