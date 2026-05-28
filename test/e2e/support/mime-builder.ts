/**
 * Minimal RFC 5322 message builder for IMAP APPEND fixtures.
 *
 * Not a general-purpose composer — strictly for seeding deterministic test
 * emails. UTF-8 bodies only; headers are ASCII-folded by the caller (test
 * subjects shouldn't need MIME-encoded-word treatment).
 */

export interface SeedEmail {
  from?: string;
  to?: string | string[];
  cc?: string;
  subject: string;
  body?: string;
  date?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  contentType?: string;
}

function fmtAddrs(v: string | string[] | undefined): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v.join(", ") : v;
}

function fmtDate(d: Date): string {
  // RFC 5322 date format. Node's toUTCString is "Tue, 27 May 2026 14:10:13 GMT"
  // which matches the production-relevant subset.
  return d.toUTCString();
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** Returns a complete CRLF-terminated RFC 5322 message ready for IMAP APPEND. */
export function buildMime(seed: SeedEmail): string {
  const headers: string[] = [];
  headers.push(`Date: ${fmtDate(seed.date ?? new Date())}`);
  headers.push(`From: ${seed.from ?? "alice@test.local"}`);
  const to = fmtAddrs(seed.to);
  if (to) headers.push(`To: ${to}`);
  if (seed.cc) headers.push(`Cc: ${seed.cc}`);
  headers.push(`Subject: ${seed.subject}`);
  headers.push(`Message-ID: <${seed.messageId ?? randomId()}@test.local>`);
  if (seed.inReplyTo) headers.push(`In-Reply-To: ${seed.inReplyTo}`);
  if (seed.references) headers.push(`References: ${seed.references}`);
  headers.push("MIME-Version: 1.0");
  headers.push(`Content-Type: ${seed.contentType ?? "text/plain; charset=UTF-8"}`);
  headers.push("Content-Transfer-Encoding: 8bit");

  const body = (seed.body ?? "Test body").replace(/\r?\n/g, "\r\n");
  return headers.join("\r\n") + "\r\n\r\n" + body + "\r\n";
}
