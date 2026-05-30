/**
 * Content-parser helpers for extracting structured data out of email bodies.
 *
 * Two independent parsers live here because both target free-text content that
 * arrives via the same email-fetch path, and both are intentionally
 * dependency-free: regex-based action-item extraction and a minimal RFC 5545
 * iCalendar parser that understands the subset of VEVENT properties we care
 * about for calendar invites.
 *
 * Both parsers are defensive by design — they never throw on malformed input,
 * they cap output size, and they treat all input as untrusted text.
 */

export interface ActionItem {
  text: string;
  assignee?: string;
  due?: string;
}

export interface Meeting {
  summary: string;
  start: string;
  /** IANA/Olson zone from a `DTSTART;TZID=...` parameter, when present. The
   *  `start` value itself stays the raw RFC 5545 date-time string. */
  startTzid?: string;
  end?: string;
  location?: string;
  organizer?: string;
  attendees?: string[];
  description?: string;
  rrule?: string;
}

// ─── Action-Item Extraction ──────────────────────────────────────────────────

/** Cap body size before scanning — avoid pathological inputs. */
const MAX_BODY_BYTES = 100 * 1024; // 100 KB
/** Maximum action items returned — avoid unbounded output. */
const MAX_ITEMS = 50;

/**
 * Common imperative verbs that signal an action item. The list stays small on
 * purpose: adding rare verbs mostly adds false positives rather than recall.
 */
const ACTION_VERBS = [
  "send", "email", "call", "schedule", "book", "reply", "respond",
  "review", "approve", "sign", "update", "fix", "write", "draft",
  "prepare", "finish", "finalize", "complete", "check", "confirm", "verify",
  "follow", "ping", "ask", "discuss", "plan", "submit", "share",
  "deliver", "ship", "deploy", "merge", "rebase", "create", "add",
  "remove", "delete", "investigate", "resolve", "close", "assign",
  "escalate", "file", "report", "test", "build", "implement", "publish",
  "read", "forward", "return", "pay", "buy", "order", "cancel",
  "contact", "notify", "reach", "coordinate", "arrange", "organize",
  "upload", "download", "sync", "install", "configure", "setup",
];
const ACTION_VERB_RE = new RegExp(`\\b(${ACTION_VERBS.join("|")})\\b`, "i");

/** Bullet markers we recognise at the start of a line. Includes the Unicode
 *  bullets Mac/Office plaintext commonly emits (‣ ▪ ◦ ◾ ○ ▶ →) and the em-dash
 *  (—) used as a dash bullet (PARSE-019, audit-2026-05-28). */
const BULLET_RE = /^\s*(?:[-*•‣▪◦◾○▶→—]|\d+[.)]|\[[ xX]\])\s+/;

/** Explicit "TODO:" / "ACTION:" / "ACTION ITEM:" markers — prefix is stripped. */
const TODO_MARKER_RE = /^\s*(?:TODO|ACTION(?:\s+ITEM)?|FOLLOW[\s-]?UP)\s*:\s*/i;

/** @mention assignee pattern. */
const MENTION_RE = /(?<![A-Za-z0-9_])@([A-Za-z][A-Za-z0-9_.-]{0,39})/;

/** Bracketed assignee pattern — [Alice], [@bob]. */
const BRACKET_ASSIGNEE_RE = /\[\s*@?([A-Za-z][A-Za-z0-9_.-]{0,39})\s*\]/;

/** Deadline pattern — by/due/before <phrase>. Captures a short trailing phrase. */
const DEADLINE_RE = /\b(?:by|due(?:\s+by)?|before)\s+([A-Za-z0-9][\w,:/ -]{2,40})/i;

/**
 * Extract action-item-looking lines from a plain-text email body.
 *
 * Heuristic: a line is an action item if it either
 *   (a) starts with a bullet marker AND contains an action verb, or
 *   (b) contains an explicit marker (TODO:, ACTION:, @mention).
 *
 * Output is trimmed, deduplicated by lowercase text, and capped at 50 items.
 */
export function extractActionItems(body: string): ActionItem[] {
  if (typeof body !== "string" || body.length === 0) return [];

  // Cap input size to avoid pathological scans. Both the check and the cut are
  // in UTF-8 *bytes*: slicing a Buffer and decoding back keeps the cap honest
  // for multibyte bodies, where a char-count slice would let ~4x the bytes
  // through (PARSE-013, audit-2026-05-28). A multibyte char straddling the
  // boundary decodes to U+FFFD, which is harmless for downstream line scanning.
  const bytes = Buffer.from(body, "utf-8");
  const truncated = bytes.length > MAX_BODY_BYTES
    ? bytes.subarray(0, MAX_BODY_BYTES).toString("utf-8")
    : body;

  const lines = truncated.split(/\r?\n/);
  const items: ActionItem[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    if (items.length >= MAX_ITEMS) break;
    const line = rawLine.trim();
    if (!line) continue;

    // Strip a leading bullet marker if present.
    const bulletMatch = BULLET_RE.exec(line);
    const afterBullet = bulletMatch ? line.slice(bulletMatch[0].length).trim() : line;

    // Strip an explicit TODO/ACTION marker if present.
    const todoMatch = TODO_MARKER_RE.exec(afterBullet);
    const text = todoMatch ? afterBullet.slice(todoMatch[0].length).trim() : afterBullet;
    if (!text) continue;

    const hasBullet = bulletMatch !== null;
    const hasMarker = todoMatch !== null;
    const mentionMatch = MENTION_RE.exec(text);
    const bracketMatch = BRACKET_ASSIGNEE_RE.exec(text);
    const hasAssignee = mentionMatch !== null || bracketMatch !== null;
    const hasVerb = ACTION_VERB_RE.test(text);

    // Acceptance rules:
    //   - explicit TODO/ACTION marker → always accept
    //   - @mention or [assignee] → always accept
    //   - bullet + action verb → accept
    // Unlabelled prose sentences are rejected even if they contain verbs —
    // email bodies are full of those and false-positive rate gets ugly.
    if (!hasMarker && !hasAssignee && !(hasBullet && hasVerb)) continue;

    // Dedup key is case-, whitespace-, and trailing-punctuation-insensitive so
    // "Fix bug." and "Fix bug!" collapse to one item (PARSE-018, audit-2026-05-28).
    const key = text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);

    const item: ActionItem = { text };

    if (mentionMatch) {
      item.assignee = mentionMatch[1];
    } else if (bracketMatch) {
      item.assignee = bracketMatch[1];
    }

    const dueMatch = DEADLINE_RE.exec(text);
    if (dueMatch) {
      // Strip any trailing punctuation the greedy phrase may have pulled in.
      item.due = dueMatch[0].replace(/[.,;:!?)]+$/, "").trim();
    }

    items.push(item);
  }

  return items;
}

// ─── iCalendar (RFC 5545) Parsing ────────────────────────────────────────────

/**
 * Apply RFC 5545 §3.1 line unfolding: a CRLF followed by a space or tab marks
 * a continuation of the previous line. Both CRLF and bare LF inputs are
 * accepted — bare-LF is out-of-spec but real-world ICS files routinely ship
 * that way after passing through relays or being saved by hand.
 */
function unfoldLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const folded: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (folded.length > 0) {
        folded[folded.length - 1] += line.slice(1);
        continue;
      }
      // A leading space/tab on the very first line is not a fold continuation
      // (there's nothing to fold onto). Trim it so splitProperty doesn't read
      // the property name as " SUMMARY" and drop it (PARSE-012, audit-2026-05-28).
      folded.push(line.replace(/^[ \t]+/, ""));
      continue;
    }
    folded.push(line);
  }
  return folded;
}

/**
 * Split a property line like `ATTENDEE;CN=Alice;RSVP=TRUE:mailto:a@x.com`
 * into its name, parameters, and value. Parameter keys are upper-cased; values
 * keep their original case (TZID zone names are case-sensitive).
 */
function splitProperty(
  line: string,
): { name: string; value: string; params: Record<string, string> } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const semiIdx = left.indexOf(";");
  const name = (semiIdx < 0 ? left : left.slice(0, semiIdx)).trim().toUpperCase();
  const params: Record<string, string> = {};
  if (semiIdx >= 0) {
    for (const part of left.slice(semiIdx + 1).split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
    }
  }
  return { name, value, params };
}

/**
 * Unescape the minimum set of RFC 5545 text escapes we care about: `\n`/`\N`
 * become newlines; `\,`, `\;`, and `\\` drop the backslash.
 */
function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Strip a case-insensitive `mailto:` prefix from an ATTENDEE/ORGANIZER value. */
function stripMailto(value: string): string {
  return value.replace(/^mailto:/i, "").trim();
}

/**
 * Parse a text blob (an .ics file, a text/calendar attachment body, or an
 * inline iCalendar chunk inside an email body) and return the first VEVENT
 * found, or null if the block is missing/malformed/empty.
 *
 * Only the subset of properties relevant to rendering a meeting to an end
 * user is extracted — unknown properties are ignored, and the parser never
 * throws on bad input.
 */
export function parseIcs(text: string): Meeting | null {
  if (typeof text !== "string" || text.length === 0) return null;

  const lines = unfoldLines(text);

  // Locate the first VEVENT block. ICS files often contain multiple VEVENTs
  // (recurring exceptions, etc.) — we return just the first to keep the tool
  // response shape simple; callers that need more can iterate themselves.
  // A VEVENT block may legally carry parameters on its BEGIN line, e.g.
  // `BEGIN:VEVENT;X-MICROSOFT-CDO-BUSYSTATUS=BUSY` from some legacy producers.
  // Match on the property name/value rather than strict equality so those
  // aren't silently skipped (PARSE-011, audit-2026-05-28).
  const isBoundary = (line: string, keyword: "BEGIN" | "END", value: string): boolean => {
    const prop = splitProperty(line);
    return prop !== null && prop.name === keyword &&
      prop.value.trim().toUpperCase().split(";")[0] === value;
  };
  let inEvent = false;
  let eventLines: string[] = [];
  for (const line of lines) {
    if (isBoundary(line, "BEGIN", "VEVENT")) {
      inEvent = true;
      eventLines = [];
      continue;
    }
    if (isBoundary(line, "END", "VEVENT")) {
      if (inEvent) break;
    }
    if (inEvent) eventLines.push(line);
  }
  if (!inEvent || eventLines.length === 0) return null;

  let summary: string | undefined;
  let start: string | undefined;
  let startTzid: string | undefined;
  let end: string | undefined;
  let location: string | undefined;
  let organizer: string | undefined;
  const attendees: string[] = [];
  let description: string | undefined;
  let rrule: string | undefined;

  for (const raw of eventLines) {
    const prop = splitProperty(raw);
    if (!prop) continue;
    const { name, value, params } = prop;

    switch (name) {
      case "SUMMARY":
        summary = unescapeIcsText(value);
        break;
      case "DTSTART":
        start = value.trim();
        // Capture the zone from `DTSTART;TZID=America/New_York:...` so the
        // naïve local date-time string isn't presented zoneless (PARSE-010).
        if (params.TZID) startTzid = params.TZID;
        break;
      case "DTEND":
        end = value.trim();
        break;
      case "LOCATION":
        location = unescapeIcsText(value);
        break;
      case "ORGANIZER": {
        const addr = stripMailto(value);
        if (addr) organizer = addr;
        break;
      }
      case "ATTENDEE": {
        const addr = stripMailto(value);
        if (addr) attendees.push(addr);
        break;
      }
      case "DESCRIPTION":
        description = unescapeIcsText(value);
        break;
      case "RRULE":
        rrule = value.trim();
        break;
      default:
        // Ignore unknown properties — keeps us forward-compatible with
        // calendars that carry extensions (X- props, CATEGORIES, etc.).
        break;
    }
  }

  // A VEVENT is only meaningful with at minimum a SUMMARY and a DTSTART.
  // Anything less is either an empty block or a malformed fragment.
  if (!summary || !start) return null;

  const meeting: Meeting = { summary, start };
  if (startTzid) meeting.startTzid = startTzid;
  if (end) meeting.end = end;
  if (location) meeting.location = location;
  if (organizer) meeting.organizer = organizer;
  if (attendees.length > 0) meeting.attendees = attendees;
  if (description) meeting.description = description;
  if (rrule) meeting.rrule = rrule;
  return meeting;
}
