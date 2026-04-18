import { describe, it, expect } from "vitest";
import { extractActionItems, parseIcs } from "./content-parser.js";

// ─── extractActionItems ──────────────────────────────────────────────────────

describe("extractActionItems", () => {
  it("extracts dash/star/bullet-prefixed action-verb lines", () => {
    const body = [
      "Here are the next steps:",
      "- send the report to Alice",
      "* review the draft before Friday",
      "• schedule the kickoff meeting",
      "just a regular sentence with no verb",
    ].join("\n");
    const items = extractActionItems(body);
    const texts = items.map(i => i.text);
    expect(texts).toContain("send the report to Alice");
    expect(texts).toContain("review the draft before Friday");
    expect(texts).toContain("schedule the kickoff meeting");
    // A bare sentence without a bullet or marker should not be picked up.
    expect(texts).not.toContain("just a regular sentence with no verb");
  });

  it("extracts numbered and checkbox-bulleted items", () => {
    const body = [
      "1. confirm the room booking",
      "2) send the agenda by tomorrow",
      "[ ] review PR before EOD",
      "[x] write the summary email",
    ].join("\n");
    const items = extractActionItems(body);
    expect(items.map(i => i.text)).toEqual(
      expect.arrayContaining([
        "confirm the room booking",
        "send the agenda by tomorrow",
        "review PR before EOD",
        "write the summary email",
      ]),
    );
  });

  it("accepts TODO: / ACTION: / FOLLOW-UP markers without needing a bullet", () => {
    const body = [
      "TODO: refactor the scheduler",
      "ACTION: ping the vendor about pricing",
      "ACTION ITEM: file the expense report",
      "FOLLOW-UP: circle back on the proposal",
    ].join("\n");
    const items = extractActionItems(body);
    const texts = items.map(i => i.text);
    expect(texts).toContain("refactor the scheduler");
    expect(texts).toContain("ping the vendor about pricing");
    expect(texts).toContain("file the expense report");
    expect(texts).toContain("circle back on the proposal");
  });

  it("captures @mention and bracketed assignee", () => {
    const body = [
      "- @alice please review the doc",
      "- [Bob] investigate the crash",
      "- write tests", // no assignee
    ].join("\n");
    const items = extractActionItems(body);
    const alice = items.find(i => /alice/i.test(i.text));
    const bob = items.find(i => /investigate/i.test(i.text));
    expect(alice?.assignee).toBe("alice");
    expect(bob?.assignee).toBe("Bob");
    // No-assignee line should be present but without an assignee field.
    const writeTests = items.find(i => i.text === "write tests");
    expect(writeTests).toBeDefined();
    expect(writeTests?.assignee).toBeUndefined();
  });

  it("captures due-date phrases via 'by' / 'due' / 'before'", () => {
    const body = [
      "- send the invoice by Friday",
      "- finalize the slide deck due 2026-05-01",
      "- publish the post before end of month",
    ].join("\n");
    const items = extractActionItems(body);
    expect(items[0].due).toMatch(/by Friday/i);
    expect(items[1].due).toMatch(/due 2026-05-01/i);
    expect(items[2].due).toMatch(/before end of month/i);
  });

  it("returns [] for empty or non-string bodies", () => {
    expect(extractActionItems("")).toEqual([]);
    expect(extractActionItems(undefined as unknown as string)).toEqual([]);
    expect(extractActionItems(null as unknown as string)).toEqual([]);
    expect(extractActionItems(42 as unknown as string)).toEqual([]);
  });

  it("truncates bodies over 100 KB rather than scanning forever", () => {
    // 120 KB of padding followed by a marker that, if the body isn't
    // truncated, would be picked up. Because we cap at 100 KB the trailing
    // marker sits past the cut-off and should never appear.
    const padding = "x".repeat(120 * 1024);
    const body = padding + "\nTODO: never seen because truncated";
    const items = extractActionItems(body);
    expect(items.find(i => /never seen/.test(i.text))).toBeUndefined();
  });

  it("deduplicates items by normalized lowercase text", () => {
    const body = [
      "- send the report",
      "- Send   the  Report", // differs only in case / whitespace
      "- SEND THE REPORT",
    ].join("\n");
    const items = extractActionItems(body);
    expect(items).toHaveLength(1);
  });

  it("caps at 50 items even when more candidates exist", () => {
    const body = Array.from({ length: 80 }, (_, i) => `- send email number ${i}`).join("\n");
    const items = extractActionItems(body);
    expect(items).toHaveLength(50);
  });
});

// ─── parseIcs ────────────────────────────────────────────────────────────────

describe("parseIcs", () => {
  it("parses a basic VEVENT block into structured fields", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "SUMMARY:Team Sync",
      "DTSTART:20260420T140000Z",
      "DTEND:20260420T150000Z",
      "LOCATION:Room 3",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting).not.toBeNull();
    expect(meeting?.summary).toBe("Team Sync");
    expect(meeting?.start).toBe("20260420T140000Z");
    expect(meeting?.end).toBe("20260420T150000Z");
    expect(meeting?.location).toBe("Room 3");
  });

  it("handles RFC 5545 line folding (CRLF + space/tab continuation)", () => {
    // Per RFC 5545 §3.1 the folding CRLF + single whitespace is stripped
    // entirely — producers must include the connecting space on the left
    // line if they want a space in the unfolded output. Well-formed ICS
    // producers do that; we replicate spec behavior rather than guessing.
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:This is a very long summary that has been ",
      " folded onto a second line per RFC 5545",
      "DTSTART:20260420T140000Z",
      "DESCRIPTION:Line one",
      "\tcontinues with a tab",
      "END:VEVENT",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting?.summary).toBe(
      "This is a very long summary that has been folded onto a second line per RFC 5545",
    );
    // No space was provided on the left side of the fold, so the continuation
    // abuts directly against the previous text.
    expect(meeting?.description).toBe("Line onecontinues with a tab");
  });

  it("collects multiple ATTENDEE lines into an array and strips MAILTO:", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:Review",
      "DTSTART:20260420T140000Z",
      "ATTENDEE;CN=Alice:mailto:alice@example.com",
      "ATTENDEE;CN=Bob:MAILTO:bob@example.com",
      "ATTENDEE:mailto:carol@example.com",
      "END:VEVENT",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting?.attendees).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });

  it("strips MAILTO: prefix on ORGANIZER too", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:Hello",
      "DTSTART:20260420T140000Z",
      "ORGANIZER;CN=Alice:MAILTO:alice@example.com",
      "END:VEVENT",
    ].join("\r\n");
    expect(parseIcs(ics)?.organizer).toBe("alice@example.com");
  });

  it("returns a meeting with no end when DTEND is missing", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:Open-ended",
      "DTSTART:20260420T140000Z",
      "END:VEVENT",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting?.start).toBe("20260420T140000Z");
    expect(meeting?.end).toBeUndefined();
  });

  it("returns null for empty, malformed, or missing VEVENT", () => {
    expect(parseIcs("")).toBeNull();
    expect(parseIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toBeNull();
    expect(parseIcs("not a calendar at all")).toBeNull();
    // VEVENT with neither SUMMARY nor DTSTART
    expect(parseIcs("BEGIN:VEVENT\nLOCATION:Somewhere\nEND:VEVENT")).toBeNull();
    // SUMMARY but no DTSTART
    expect(parseIcs("BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT")).toBeNull();
  });

  it("unescapes \\n, \\,, \\;, and \\\\ inside DESCRIPTION per RFC 5545 §3.3.11", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:x",
      "DTSTART:20260420T140000Z",
      "DESCRIPTION:Line one\\nLine two\\, with comma\\; semi\\\\ and backslash",
      "END:VEVENT",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting?.description).toBe(
      "Line one\nLine two, with comma; semi\\ and backslash",
    );
  });

  it("preserves RRULE verbatim on the parsed meeting", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:Weekly",
      "DTSTART:20260420T140000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
    ].join("\r\n");
    expect(parseIcs(ics)?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("accepts LF-only line endings (no CRLF)", () => {
    const ics = "BEGIN:VEVENT\nSUMMARY:lf only\nDTSTART:20260420T140000Z\nEND:VEVENT";
    expect(parseIcs(ics)?.summary).toBe("lf only");
  });

  it("ignores unknown properties without losing known ones", () => {
    const ics = [
      "BEGIN:VEVENT",
      "SUMMARY:mix",
      "DTSTART:20260420T140000Z",
      "X-CUSTOM-PROP:whatever",
      "CATEGORIES:personal,work",
      "SEQUENCE:0",
      "END:VEVENT",
    ].join("\r\n");
    const meeting = parseIcs(ics);
    expect(meeting?.summary).toBe("mix");
    expect(meeting?.start).toBe("20260420T140000Z");
  });
});
