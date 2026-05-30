/**
 * Analytics Service for email statistics and insights
 */

import { EmailMessage, EmailStats, EmailAnalytics, Contact } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { extractEmailAddress, extractName, bytesToMB } from '../utils/helpers.js';
import { tracer } from '../utils/tracer.js';

/** Maximum unique contacts tracked — prevents unbounded Map growth. */
const MAX_CONTACTS = 10_000;

/** Known personal email providers — we don't infer an org for these. */
const PERSONAL_DOMAINS = new Set([
  'gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'protonmail', 'aol',
  'live', 'me', 'msn', 'mail', 'inbox', 'yandex', 'gmx', 'zoho', 'fastmail',
]);

/**
 * Extract the domain from an email address (e.g. "user@acme.com" → "acme.com").
 * Returns an empty string when the address is malformed.
 */
function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/**
 * Canonicalize a Message-ID / In-Reply-To header for cross-folder matching:
 * trim whitespace and strip a single pair of surrounding angle brackets so the
 * mailparser-style `<id@host>` form matches a bare `id@host`. Returns "" for
 * nullish input.
 */
function normalizeMessageId(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
}

/**
 * Local-time YYYY-MM-DD key for a Date. Uses host-local accessors (not UTC) so
 * volume-trend day buckets line up with the user's lived calendar day. See the
 * TIME BASIS note on calculateVolumeTrends (PARSE-005/006, audit-2026-05-28).
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Infer a human-readable organisation name from a domain.
 * Returns undefined for known personal providers (gmail, yahoo, etc.)
 * and for addresses without a recognisable company segment.
 *
 * Examples:
 *   anthropic.com  → Anthropic
 *   cs.mit.edu     → MIT
 *   co.uk compound → uses third-level label
 */
function inferOrganization(domain: string): string | undefined {
  if (!domain) return undefined;
  const parts = domain.split('.');
  if (parts.length < 2) return undefined;

  const tld  = parts[parts.length - 1];
  const sld  = parts[parts.length - 2];

  // Academic / government TLDs — org is the label just before the TLD.
  // Known acronym TLDs upper-case the whole label (mit.edu → "MIT", cdc.gov →
  // "CDC") rather than title-casing it ("Mit"/"Cdc").
  if (['edu', 'gov', 'mil', 'ac'].includes(tld)) {
    return ['edu', 'gov', 'mil'].includes(tld)
      ? sld.toUpperCase()
      : sld.charAt(0).toUpperCase() + sld.slice(1);
  }

  // Compound SLDs like co.uk, com.au, gov.uk — org is one level higher, and
  // only when there's a label in front (parts.length >= 3). 'gov' appears here
  // for gov.uk-style domains; the root-TLD case (cdc.gov) is already handled by
  // the TLD branch above, so listing 'gov' in both lists previously left this
  // branch unreachable for it and mis-cased gov.uk (PARSE-017, audit-2026-05-28).
  if (['co', 'com', 'org', 'net', 'gov'].includes(sld) && parts.length >= 3) {
    const org = parts[parts.length - 3];
    if (PERSONAL_DOMAINS.has(org)) return undefined;
    return org.charAt(0).toUpperCase() + org.slice(1);
  }

  // Standard two-part domain — SLD is the org
  if (PERSONAL_DOMAINS.has(sld)) return undefined;
  return sld.charAt(0).toUpperCase() + sld.slice(1);
}

export type ContactSortBy = 'recent' | 'total' | 'sent' | 'received';

/**
 * Recency weight: harmonic decay with a 30-day half-life.
 * A contact last seen yesterday scores ~1.0; 30 days ago ~0.5; 90 days ago ~0.25.
 */
function recencyWeight(lastInteraction: Date): number {
  const daysAgo = (Date.now() - lastInteraction.getTime()) / 86_400_000;
  return 1 / (1 + daysAgo / 30);
}

export class AnalyticsService {
  private inboxEmails: EmailMessage[] = [];
  private sentEmails: EmailMessage[] = [];
  private contacts: Map<string, Contact> = new Map();
  private statsCache: EmailStats | null = null;
  private analyticsCache: EmailAnalytics | null = null;
  private lastCacheUpdate: Date | null = null;
  private cacheValidityMs: number = 5 * 60 * 1000; // 5 minutes

  /**
   * Update the analytics dataset. Pass both inbox and sent folders for accurate
   * volume trends, contact stats, and response-time calculation.
   * Does NOT clear the computed cache — the cache is only cleared when new data
   * differs from what is already stored, preventing spurious invalidation.
   */
  updateEmails(inbox: EmailMessage[], sent: EmailMessage[] = []): void {
    tracer.spanSync('analytics.updateEmails', { inboxCount: inbox.length, sentCount: sent.length }, () => {
    logger.debug(
      `Updating analytics with ${inbox.length} inbox / ${sent.length} sent emails`,
      'AnalyticsService'
    );
    this.inboxEmails = inbox;
    this.sentEmails = sent;
    this.invalidateCache();
    this.processContacts();
    }); // end tracer.spanSync('analytics.updateEmails')
  }

  /** @deprecated Use updateEmails(inbox, sent) — kept for backward compatibility */
  get emails(): EmailMessage[] {
    return this.inboxEmails;
  }

  private invalidateCache(): void {
    this.statsCache = null;
    this.analyticsCache = null;
    this.lastCacheUpdate = null;
  }

  private isCacheValid(): boolean {
    if (!this.lastCacheUpdate) return false;
    const cacheAge = Date.now() - this.lastCacheUpdate.getTime();
    return cacheAge < this.cacheValidityMs;
  }

  /**
   * Build the contact map from both inbox (received) and sent emails.
   * - inbox emails → the `from` address sent a message to us
   * - sent emails  → the `to` addresses received a message from us
   *
   * Sent recipients are processed FIRST. The MAX_CONTACTS cap drops new
   * contacts in insertion order once full; people the user actually emails are
   * the highest-value contacts, so they must claim their map slots before a
   * flood of one-off inbox senders (newsletters, bounces) can exhaust the cap
   * (PARSE-004, audit-2026-05-28).
   */
  private processContacts(): void {
    this.contacts.clear();

    for (const email of this.sentEmails) {
      for (const to of email.to) {
        const toAddress = extractEmailAddress(to);
        const toName    = extractName(to);
        if (toAddress) {
          this.updateContact(toAddress, 'sent', email.date, toName);
        }
      }
    }

    for (const email of this.inboxEmails) {
      const fromAddress = extractEmailAddress(email.from);
      const fromName    = extractName(email.from);
      if (fromAddress) {
        this.updateContact(fromAddress, 'received', email.date, fromName);
      }
    }

    logger.debug(`Processed ${this.contacts.size} contacts`, 'AnalyticsService');
  }

  private updateContact(email: string, type: 'sent' | 'received', date: Date, displayName?: string): void {
    let contact = this.contacts.get(email);

    if (!contact) {
      if (this.contacts.size >= MAX_CONTACTS) return;
      const domain = emailDomain(email);
      contact = {
        email,
        domain,
        organization: inferOrganization(domain),
        emailsSent: 0,
        emailsReceived: 0,
        lastInteraction: date,
        firstInteraction: date,
      };
      this.contacts.set(email, contact);
    }

    if (type === 'sent') {
      contact.emailsSent++;
    } else {
      contact.emailsReceived++;
    }

    if (date > contact.lastInteraction) {
      contact.lastInteraction = date;
      // Prefer the most recently seen display name (tends to be most current).
      if (displayName) contact.name = displayName;
    }
    if (date < contact.firstInteraction) {
      contact.firstInteraction = date;
    }
    // Seed name on first occurrence if not yet set.
    if (!contact.name && displayName) contact.name = displayName;
  }

  getEmailStats(): EmailStats {
    const cached = !!(this.statsCache && this.isCacheValid());
    return tracer.spanSync('analytics.getEmailStats', { cached }, () => {
    if (cached) {
      return this.statsCache!;
    }

    logger.debug('Calculating email statistics', 'AnalyticsService');

    const allEmails = [...this.inboxEmails, ...this.sentEmails];
    const totalEmails = allEmails.length;
    const unreadEmails = this.inboxEmails.filter(e => !e.isRead).length;
    const starredEmails = allEmails.filter(e => e.isStarred).length;

    const folders = new Set(allEmails.map(e => e.folder));
    const totalFolders = folders.size;

    let averageEmailsPerDay = 0;
    if (allEmails.length > 0) {
      // Use reduce instead of spread (Math.min/max(...array)) to avoid
      // "Maximum call stack size exceeded" on very large arrays.
      const oldestDate = allEmails.reduce((min, e) => Math.min(min, e.date.getTime()), Infinity);
      const newestDate = allEmails.reduce((max, e) => Math.max(max, e.date.getTime()), -Infinity);
      const daysDiff = Math.max(1, (newestDate - oldestDate) / (1000 * 60 * 60 * 24));
      averageEmailsPerDay = Math.round(totalEmails / daysDiff);
    }

    let mostActiveContact = 'N/A';
    let maxInteractions = 0;
    for (const [email, contact] of this.contacts.entries()) {
      const interactions = contact.emailsSent + contact.emailsReceived;
      if (interactions > maxInteractions) {
        maxInteractions = interactions;
        mostActiveContact = email;
      }
    }

    const folderCounts = new Map<string, number>();
    for (const email of allEmails) {
      folderCounts.set(email.folder, (folderCounts.get(email.folder) || 0) + 1);
    }

    let mostUsedFolder = 'INBOX';
    let maxFolderCount = 0;
    for (const [folder, count] of folderCounts.entries()) {
      if (count > maxFolderCount) {
        maxFolderCount = count;
        mostUsedFolder = folder;
      }
    }

    let totalBytes = 0;
    for (const email of allEmails) {
      totalBytes += email.body?.length ?? 0;
      if (email.attachments) {
        for (const att of email.attachments) {
          // att.size is number|undefined; an unguarded += yields NaN that then
          // poisons storageUsedMB (PARSE-015, audit-2026-05-28).
          totalBytes += att.size ?? 0;
        }
      }
    }

    const stats: EmailStats = {
      totalEmails,
      unreadEmails,
      starredEmails,
      totalFolders,
      totalContacts: this.contacts.size,
      averageEmailsPerDay,
      mostActiveContact,
      mostUsedFolder,
      storageUsedMB: bytesToMB(totalBytes),
    };

    this.statsCache = stats;
    this.lastCacheUpdate = new Date();
    return stats;
    }); // end tracer.spanSync('analytics.getEmailStats')
  }

  getEmailAnalytics(): EmailAnalytics {
    return tracer.spanSync('analytics.getEmailAnalytics', {}, () => {
    if (this.analyticsCache && this.isCacheValid()) {
      return this.analyticsCache;
    }

    logger.debug('Calculating email analytics', 'AnalyticsService');

    const volumeTrends = this.calculateVolumeTrends(30);

    const topSenders = Array.from(this.contacts.values())
      .filter(c => c.emailsReceived > 0)
      .sort((a, b) => b.emailsReceived - a.emailsReceived)
      .slice(0, 10)
      .map(c => ({ email: c.email, count: c.emailsReceived, lastContact: c.lastInteraction }));

    const topRecipients = Array.from(this.contacts.values())
      .filter(c => c.emailsSent > 0)
      .sort((a, b) => b.emailsSent - a.emailsSent)
      .slice(0, 10)
      .map(c => ({ email: c.email, count: c.emailsSent, lastContact: c.lastInteraction }));

    const responseTimeStats = this.calculateResponseTimeStats();
    const peakActivityHours = this.calculatePeakActivityHours();
    const attachmentStats = this.calculateAttachmentStats();

    const analytics: EmailAnalytics = {
      volumeTrends,
      topSenders,
      topRecipients,
      responseTimeStats,
      peakActivityHours,
      attachmentStats,
    };

    this.analyticsCache = analytics;
    this.lastCacheUpdate = new Date();
    return analytics;
    }); // end tracer.spanSync('analytics.getEmailAnalytics')
  }

  /**
   * Compute response times from sent emails that have an inReplyTo header
   * matching an inbox email. Returns null when there is insufficient data.
   * Times are expressed in hours.
   */
  private calculateResponseTimeStats(): EmailAnalytics['responseTimeStats'] {
    const responseTimes: number[] = [];

    // Build a lookup from Message-ID to inbox email date. Both the stored
    // header and inReplyTo are normalized by stripping surrounding angle
    // brackets and whitespace so `<abc@x.com>` (mailparser default) matches a
    // bare `abc@x.com`; without this the lookup misses every reply and the
    // whole stat block returns null even with data (PARSE-016, audit-2026-05-28).
    const inboxById = new Map<string, Date>();
    for (const email of this.inboxEmails) {
      const msgIdRaw = email.headers?.['message-id'];
      const msgId = Array.isArray(msgIdRaw) ? msgIdRaw[0] : msgIdRaw;
      const key = normalizeMessageId(msgId);
      if (key) {
        inboxById.set(key, email.date);
      }
    }

    for (const sent of this.sentEmails) {
      if (!sent.inReplyTo) continue;
      const originalDate = inboxById.get(normalizeMessageId(sent.inReplyTo));
      if (!originalDate) continue;

      const diffHours = (sent.date.getTime() - originalDate.getTime()) / (1000 * 60 * 60);
      // Only count plausible replies (within 30 days, after the original)
      if (diffHours > 0 && diffHours <= 30 * 24) {
        responseTimes.push(diffHours);
      }
    }

    if (responseTimes.length === 0) return null;

    responseTimes.sort((a, b) => a - b);
    const average = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    // Conventional median: mean of the two middle elements for even-length
    // arrays, not the upper-middle element (PARSE-007, audit-2026-05-28).
    const n = responseTimes.length;
    const median = n % 2
      ? responseTimes[(n - 1) / 2]
      : (responseTimes[n / 2 - 1] + responseTimes[n / 2]) / 2;

    return {
      average: parseFloat(average.toFixed(1)),
      median: parseFloat(median.toFixed(1)),
      fastest: parseFloat(responseTimes[0].toFixed(1)),
      slowest: parseFloat(responseTimes[responseTimes.length - 1].toFixed(1)),
      sampleSize: responseTimes.length,
    };
  }

  /**
   * Volume trends split by received (inbox) and sent (sent folder).
   *
   * TIME BASIS: host-local time. Day boundaries (this method) and the hour of
   * day (calculatePeakActivityHours) are both computed against the host's local
   * zone so the two charts derived from the same dataset agree, and so a "Mon"
   * bar reflects the day the user actually experienced rather than UTC. An
   * email received at 9 PM ET Monday now counts toward Monday, not Tuesday-UTC
   * (PARSE-005/006, audit-2026-05-28). No TZ library is used — date keys come
   * from local Date accessors via localDateKey().
   *
   * Buckets are seeded by walking back `days` *calendar* days using local
   * y/m/d construction (not fixed 86.4M-ms steps), so a DST transition can
   * never collapse two local days onto one key or skip a day.
   */
  private calculateVolumeTrends(days: number): EmailAnalytics['volumeTrends'] {
    const trends = new Map<string, { received: number; sent: number }>();

    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      trends.set(localDateKey(d), { received: 0, sent: 0 });
    }

    for (const email of this.inboxEmails) {
      const entry = trends.get(localDateKey(email.date));
      if (entry) entry.received++;
    }

    for (const email of this.sentEmails) {
      const entry = trends.get(localDateKey(email.date));
      if (entry) entry.sent++;
    }

    return Array.from(trends.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Peak activity hours use email.date.getHours() (host-local), matching the
  // local-day basis of calculateVolumeTrends — see that method's TIME BASIS note.
  private calculatePeakActivityHours(): { hour: number; count: number }[] {
    const hourCounts = new Map<number, number>();
    for (let i = 0; i < 24; i++) hourCounts.set(i, 0);

    for (const email of [...this.inboxEmails, ...this.sentEmails]) {
      const hour = email.date.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    return Array.from(hourCounts.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private calculateAttachmentStats(): EmailAnalytics['attachmentStats'] {
    let totalAttachments = 0;
    let totalSizeBytes = 0;
    const typeCounts = new Map<string, number>();

    for (const email of [...this.inboxEmails, ...this.sentEmails]) {
      if (email.attachments) {
        totalAttachments += email.attachments.length;
        for (const att of email.attachments) {
          totalSizeBytes += att.size ?? 0; // guard number|undefined → no NaN (PARSE-015)
          const type = att.contentType?.split('/')[0] || 'other';
          typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
      }
    }

    const mostCommonTypes = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalAttachments,
      totalSizeMB: bytesToMB(totalSizeBytes),
      averageSizeMB: totalAttachments > 0 ? bytesToMB(totalSizeBytes / totalAttachments) : 0,
      mostCommonTypes,
    };
  }

  getContacts(limit: number = 100, sortBy: ContactSortBy = 'recent'): Contact[] {
    const tags = { limit, sortBy } as { limit: number; sortBy: string; resultCount?: number };
    return tracer.spanSync('analytics.getContacts', tags, () => {
    // Clamp: minimum 1, maximum 500.
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit) || 100), 500);

    const comparators: Record<ContactSortBy, (a: Contact, b: Contact) => number> = {
      recent: (a, b) => {
        const aScore = (a.emailsSent + a.emailsReceived) * recencyWeight(a.lastInteraction);
        const bScore = (b.emailsSent + b.emailsReceived) * recencyWeight(b.lastInteraction);
        return bScore - aScore;
      },
      total:    (a, b) => (b.emailsSent + b.emailsReceived) - (a.emailsSent + a.emailsReceived),
      sent:     (a, b) => b.emailsSent     - a.emailsSent,
      received: (a, b) => b.emailsReceived - a.emailsReceived,
    };

    const result = Array.from(this.contacts.values())
      .sort(comparators[sortBy] ?? comparators.recent)
      .slice(0, safeLimit);
    tags.resultCount = result.length;
    return result;
    }); // end tracer.spanSync('analytics.getContacts')
  }

  getVolumeTrends(days: number = 30): EmailAnalytics['volumeTrends'] {
    return tracer.spanSync('analytics.getVolumeTrends', { days }, () => {
    // Clamp 1–365.  An unchecked caller could request 10000 days, creating
    // a 10000-entry map/array and burning proportional CPU allocating it.
    const safeDays = Math.min(Math.max(1, Math.trunc(days) || 30), 365);
    return this.calculateVolumeTrends(safeDays);
    }); // end tracer.spanSync('analytics.getVolumeTrends')
  }

  clearCache(): void {
    this.invalidateCache();
    logger.info('Analytics cache cleared', 'AnalyticsService');
  }

  clearAll(): void {
    this.inboxEmails = [];
    this.sentEmails = [];
    this.contacts.clear();
    this.invalidateCache();
    logger.info('All analytics data cleared', 'AnalyticsService');
  }

  /** Securely wipe all email data from memory. */
  wipeData(): void {
    for (const email of this.inboxEmails) {
      if (email.body) email.body = "";
      if (email.subject) email.subject = "";
      if (email.from) email.from = "";
    }
    for (const email of this.sentEmails) {
      if (email.body) email.body = "";
      if (email.subject) email.subject = "";
      if (email.from) email.from = "";
    }
    this.inboxEmails = [];
    this.sentEmails = [];
    this.contacts.clear();
    this.invalidateCache();
    logger.info('Analytics data wiped from memory', 'AnalyticsService');
  }
}
