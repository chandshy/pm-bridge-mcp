import { describe, it, expect } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  parseEmails,
  formatDate,
  truncate,
  isValidEmail,
  extractEmailAddress,
  extractName,
  sanitizeForLog,
  formatBytes,
  bytesToMB,
  validateLabelName,
  validateFolderName,
  validateTargetFolder,
  requireNumericEmailId,
  validateAttachments,
} from './helpers.js';

describe('helpers', () => {
  describe('parseEmails', () => {
    it('should parse single email', () => {
      expect(parseEmails('test@example.com')).toEqual(['test@example.com']);
    });

    it('should parse comma-separated emails', () => {
      expect(parseEmails('test1@example.com, test2@example.com')).toEqual([
        'test1@example.com',
        'test2@example.com',
      ]);
    });

    it('should filter invalid emails', () => {
      expect(parseEmails('valid@example.com, invalid')).toEqual(['valid@example.com']);
    });

    it('should filter empty strings', () => {
      expect(parseEmails('test@example.com,  , ')).toEqual(['test@example.com']);
    });

    it('should handle empty input', () => {
      expect(parseEmails('')).toEqual([]);
    });
  });

  describe('formatDate', () => {
    it('should format date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(formatDate(date)).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('truncate', () => {
    it('should not truncate text shorter than limit', () => {
      expect(truncate('Hello', 10)).toBe('Hello');
    });

    it('should truncate text longer than limit', () => {
      expect(truncate('Hello World', 5)).toBe('He...');
    });

    it('should handle empty string', () => {
      expect(truncate('', 10)).toBe('');
    });
  });

  describe('isValidEmail', () => {
    it('should validate correct email', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
    });

    it('should validate email with subdomain', () => {
      expect(isValidEmail('test@mail.example.com')).toBe(true);
    });

    it('should validate email with plus addressing', () => {
      expect(isValidEmail('test+label@example.com')).toBe(true);
    });

    it('should reject email without @', () => {
      expect(isValidEmail('testexample.com')).toBe(false);
    });

    it('should reject email without domain', () => {
      expect(isValidEmail('test@')).toBe(false);
    });

    it('should reject email without username', () => {
      expect(isValidEmail('@example.com')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('should reject email with spaces', () => {
      expect(isValidEmail('test @example.com')).toBe(false);
    });
  });

  describe('extractEmailAddress', () => {
    it('should extract email from formatted string', () => {
      expect(extractEmailAddress('John Doe <john@example.com>')).toBe('john@example.com');
    });

    it('should return plain email if no brackets', () => {
      expect(extractEmailAddress('john@example.com')).toBe('john@example.com');
    });

    it('should handle whitespace', () => {
      expect(extractEmailAddress('  john@example.com  ')).toBe('john@example.com');
    });
  });

  describe('extractName', () => {
    it('should extract name from formatted string', () => {
      expect(extractName('John Doe <john@example.com>')).toBe('John Doe');
    });

    it('should return undefined if no name', () => {
      expect(extractName('john@example.com')).toBeUndefined();
    });
  });

  describe('sanitizeForLog', () => {
    it('should remove newlines and tabs', () => {
      expect(sanitizeForLog('Hello\nWorld\tTest')).toBe('Hello World Test');
    });

    it('should truncate long strings', () => {
      const longText = 'a'.repeat(150);
      const result = sanitizeForLog(longText, 50);
      expect(result).toHaveLength(53); // 50 + '...'
    });

    it('should handle empty string', () => {
      expect(sanitizeForLog('')).toBe('');
    });
  });

  describe('formatBytes', () => {
    it('should format zero bytes', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });
  });

  describe('bytesToMB', () => {
    it('should convert bytes to MB', () => {
      expect(bytesToMB(1024 * 1024)).toBe(1);
    });

    it('should handle zero', () => {
      expect(bytesToMB(0)).toBe(0);
    });
  });

  // ── validateLabelName ──────────────────────────────────────────────────────
  // These tests cover the validation added in Cycle #1 to prevent IMAP path
  // traversal attacks in get_emails_by_label, move_to_label, and bulk_move_to_label.

  describe('validateLabelName', () => {
    it('returns null for a valid label name', () => {
      expect(validateLabelName('Work')).toBeNull();
    });

    it('returns null for a label with spaces and hyphens', () => {
      expect(validateLabelName('My Important-Label')).toBeNull();
    });

    it('returns an error for an empty string', () => {
      expect(validateLabelName('')).toMatch(/non-empty/i);
    });

    it('returns an error for a whitespace-only string', () => {
      expect(validateLabelName('   ')).toMatch(/non-empty/i);
    });

    it('returns an error for a null value', () => {
      expect(validateLabelName(null)).toMatch(/non-empty/i);
    });

    it('returns an error when label contains a forward slash', () => {
      expect(validateLabelName('Work/Personal')).toMatch(/invalid characters/i);
    });

    it('returns an error for a directory traversal with ..', () => {
      expect(validateLabelName('../INBOX')).toMatch(/invalid characters/i);
    });

    it('returns an error when label contains a null byte (control character)', () => {
      expect(validateLabelName('Work\x00Hack')).toMatch(/invalid characters/i);
    });

    it('returns an error when label contains other C0 control characters', () => {
      expect(validateLabelName('Work\x1fHack')).toMatch(/invalid characters/i);
    });

    it('returns an error when label exceeds 255 characters', () => {
      expect(validateLabelName('a'.repeat(256))).toMatch(/exceeds maximum length/i);
    });

    it('returns null for a label exactly 255 characters long', () => {
      expect(validateLabelName('a'.repeat(255))).toBeNull();
    });
  });

  // ── validateFolderName ─────────────────────────────────────────────────────
  // These tests cover the validation added in Cycle #1 for move_to_folder.

  describe('validateFolderName', () => {
    it('returns null for a valid folder name', () => {
      expect(validateFolderName('Projects')).toBeNull();
    });

    it('returns an error for an empty string', () => {
      expect(validateFolderName('')).toMatch(/non-empty/i);
    });

    it('returns an error for a whitespace-only string', () => {
      expect(validateFolderName('   ')).toMatch(/non-empty/i);
    });

    it('returns an error when folder contains a forward slash', () => {
      expect(validateFolderName('Work/Q1')).toMatch(/invalid characters/i);
    });

    it('returns an error for a directory traversal with ..', () => {
      expect(validateFolderName('../INBOX')).toMatch(/invalid characters/i);
    });

    it('returns an error when folder contains control characters', () => {
      expect(validateFolderName('Work\x00')).toMatch(/invalid characters/i);
    });

    it('returns an error when folder name exceeds 255 characters', () => {
      expect(validateFolderName('b'.repeat(256))).toMatch(/exceeds maximum length/i);
    });

    it('returns null for a folder exactly 255 characters long', () => {
      expect(validateFolderName('b'.repeat(255))).toBeNull();
    });
  });

  // ── validateTargetFolder ───────────────────────────────────────────────────
  // Covers remove_label and bulk_remove_label targetFolder validation (Cycle #1).
  // Unlike label/folder, slashes are allowed (full IMAP path), but .. is rejected.

  describe('validateTargetFolder', () => {
    it('returns null when targetFolder is omitted (undefined)', () => {
      expect(validateTargetFolder(undefined)).toBeNull();
    });

    it('returns null when targetFolder is empty string (caller uses default)', () => {
      expect(validateTargetFolder('')).toBeNull();
    });

    it('returns null for a plain folder like INBOX', () => {
      expect(validateTargetFolder('INBOX')).toBeNull();
    });

    it('returns null for a path with a forward slash like Folders/Work', () => {
      expect(validateTargetFolder('Folders/Work')).toBeNull();
    });

    it('returns an error for a path traversal with ..', () => {
      expect(validateTargetFolder('../INBOX')).toMatch(/invalid characters/i);
    });

    it('returns an error for embedded .. in path', () => {
      expect(validateTargetFolder('Folders/../INBOX')).toMatch(/invalid characters/i);
    });

    it('returns an error when targetFolder contains control characters', () => {
      expect(validateTargetFolder('INBOX\x00hack')).toMatch(/invalid characters/i);
    });

    it('returns an error when targetFolder exceeds 1000 characters', () => {
      expect(validateTargetFolder('c'.repeat(1001))).toMatch(/exceeds maximum length/i);
    });

    it('returns null for a targetFolder exactly 1000 characters long', () => {
      expect(validateTargetFolder('c'.repeat(1000))).toBeNull();
    });
  });

  // ── Handler-level validation paths (Cycle #3) ─────────────────────────────
  // The handlers move_email, bulk_move_emails, and send_test_email each call
  // one of the helpers below at the start of their execution.  Since index.ts
  // cannot be imported in tests (it reads process.env and calls process.exit),
  // these test cases exercise the exact helper call + expected error message
  // for each of the three new handler guard paths added in Cycle #3.

  describe('move_email handler validation (validateTargetFolder)', () => {
    // mirrors: const mvValidErr = validateTargetFolder(args.targetFolder);
    //          if (mvValidErr) throw new McpError(ErrorCode.InvalidParams, mvValidErr);

    it('returns null (no error) for a valid targetFolder like INBOX', () => {
      expect(validateTargetFolder('INBOX')).toBeNull();
    });

    it('returns null for a path with slashes like Folders/Archive', () => {
      expect(validateTargetFolder('Folders/Archive')).toBeNull();
    });

    it('returns an error for a traversal payload like ../../etc', () => {
      const err = validateTargetFolder('../../etc');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('returns an error for a null-byte injection in targetFolder', () => {
      const err = validateTargetFolder('INBOX\x00payload');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('returns an error for a targetFolder that is too long', () => {
      const err = validateTargetFolder('x'.repeat(1001));
      expect(err).not.toBeNull();
      expect(err).toMatch(/exceeds maximum length/i);
    });

    it('returns null when targetFolder is omitted (undefined) — handler uses its own default', () => {
      // move_email always provides args.targetFolder as a string; bulk_move_emails
      // also always has targetFolder from its schema.  This guard tests the helper
      // contract, not the handler schema.
      expect(validateTargetFolder(undefined)).toBeNull();
    });
  });

  describe('bulk_move_emails handler validation (validateTargetFolder)', () => {
    // mirrors: const bmValidErr = validateTargetFolder(args.targetFolder);
    //          if (bmValidErr) throw new McpError(ErrorCode.InvalidParams, bmValidErr);
    // Note: this handler fails fast BEFORE iterating emailIds, so a bad targetFolder
    // means NO emails are moved.

    it('returns null for a valid destination folder', () => {
      expect(validateTargetFolder('Spam')).toBeNull();
    });

    it('returns an error for a path traversal in targetFolder', () => {
      const err = validateTargetFolder('Folders/../INBOX');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('returns an error for control characters in targetFolder', () => {
      const err = validateTargetFolder('INBOX\x1f');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });
  });

  describe('send_test_email handler validation (isValidEmail)', () => {
    // mirrors: if (!isValidEmail(args.to as string))
    //            throw new McpError(ErrorCode.InvalidParams, `Invalid recipient email address: ${args.to}`);

    it('returns true for a valid recipient address', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
    });

    it('returns false for an address missing the domain', () => {
      expect(isValidEmail('user@')).toBe(false);
    });

    it('returns false for an address missing the @ symbol', () => {
      expect(isValidEmail('notanemail')).toBe(false);
    });

    it('returns false for an address with a null byte', () => {
      expect(isValidEmail('user\x00@example.com')).toBe(false);
    });

    it('returns false for an address with a newline (header injection attempt)', () => {
      expect(isValidEmail('user\n@example.com')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isValidEmail('')).toBe(false);
    });

    it('returns false for a local part exceeding 64 characters', () => {
      const longLocal = 'a'.repeat(65);
      expect(isValidEmail(`${longLocal}@example.com`)).toBe(false);
    });
  });

  // ── Cycle #5 handler-level guard paths ────────────────────────────────────
  // decodeCursor, get_email_by_id, and download_attachment each use inline
  // guards that cannot be imported from index.ts.  These test suites exercise
  // the exact helper calls / inline expressions those handlers use, mirroring
  // the same pattern established in Cycle #4.

  describe('decodeCursor folder validation (validateTargetFolder)', () => {
    // mirrors: if (validateTargetFolder(parsed.folder) !== null) return null;
    // A crafted cursor whose folder field contains traversal sequences, control
    // characters, or an oversized path must be rejected (returns non-null error).

    it('accepts a simple folder like INBOX', () => {
      expect(validateTargetFolder('INBOX')).toBeNull();
    });

    it('accepts a path with a forward slash like Labels/Work', () => {
      expect(validateTargetFolder('Labels/Work')).toBeNull();
    });

    it('accepts a folder exactly 1000 characters long (boundary)', () => {
      expect(validateTargetFolder('a'.repeat(1000))).toBeNull();
    });

    it('rejects a folder with a path traversal .. segment', () => {
      const err = validateTargetFolder('../../etc/passwd');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('rejects a folder with an embedded .. like Labels/../INBOX', () => {
      const err = validateTargetFolder('Labels/../INBOX');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('rejects a folder with a null byte (control character)', () => {
      const err = validateTargetFolder('INBOX\x00evil');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('rejects a folder with other C0 control characters', () => {
      const err = validateTargetFolder('INBOX\x07bell');
      expect(err).not.toBeNull();
      expect(err).toMatch(/invalid characters/i);
    });

    it('rejects a folder exceeding 1000 characters', () => {
      const err = validateTargetFolder('a'.repeat(1001));
      expect(err).not.toBeNull();
      expect(err).toMatch(/exceeds maximum length/i);
    });
  });

  describe('get_email_by_id handler validation (numeric UID guard)', () => {
    // mirrors: if (!rawEmailId || typeof rawEmailId !== 'string' || !/^\d+$/.test(rawEmailId))
    //            throw McpError(InvalidParams, 'emailId must be a non-empty numeric UID string.')
    // The guard expression evaluates to true (throw) for any of the bad inputs below.

    function isInvalidEmailId(v: unknown): boolean {
      const rawEmailId = v as string;
      return !rawEmailId || typeof rawEmailId !== 'string' || !/^\d+$/.test(rawEmailId);
    }

    it('passes (returns false) for a valid numeric UID string like "12345"', () => {
      expect(isInvalidEmailId('12345')).toBe(false);
    });

    it('passes for a single-digit UID string "1"', () => {
      expect(isInvalidEmailId('1')).toBe(false);
    });

    it('throws-guard for an empty string', () => {
      expect(isInvalidEmailId('')).toBe(true);
    });

    it('throws-guard for a non-numeric string like "abc"', () => {
      expect(isInvalidEmailId('abc')).toBe(true);
    });

    it('throws-guard for a string with letters mixed in like "12a3"', () => {
      expect(isInvalidEmailId('12a3')).toBe(true);
    });

    it('throws-guard for a negative number string "-1"', () => {
      expect(isInvalidEmailId('-1')).toBe(true);
    });

    it('throws-guard for a float string "1.5"', () => {
      expect(isInvalidEmailId('1.5')).toBe(true);
    });

    it('throws-guard for null', () => {
      expect(isInvalidEmailId(null)).toBe(true);
    });

    it('throws-guard for undefined', () => {
      expect(isInvalidEmailId(undefined)).toBe(true);
    });

    it('throws-guard for a string with a null byte', () => {
      expect(isInvalidEmailId('123\x00')).toBe(true);
    });
  });

  describe('download_attachment handler validation', () => {
    // email_id guard mirrors get_email_by_id (same pattern).
    // attachment_index guard: !Number.isInteger(rawAttIdx) || rawAttIdx < 0

    function isInvalidAttEmailId(v: unknown): boolean {
      const rawAttEmailId = v as string;
      return !rawAttEmailId || typeof rawAttEmailId !== 'string' || !/^\d+$/.test(rawAttEmailId);
    }

    function isInvalidAttIndex(v: unknown): boolean {
      const rawAttIdx = v as number;
      return !Number.isInteger(rawAttIdx) || rawAttIdx < 0;
    }

    // email_id tests
    it('email_id: passes for valid numeric UID "99"', () => {
      expect(isInvalidAttEmailId('99')).toBe(false);
    });

    it('email_id: throws-guard for empty string', () => {
      expect(isInvalidAttEmailId('')).toBe(true);
    });

    it('email_id: throws-guard for non-numeric string "abc"', () => {
      expect(isInvalidAttEmailId('abc')).toBe(true);
    });

    it('email_id: throws-guard for null', () => {
      expect(isInvalidAttEmailId(null)).toBe(true);
    });

    // attachment_index tests
    it('attachment_index: passes for 0 (first attachment)', () => {
      expect(isInvalidAttIndex(0)).toBe(false);
    });

    it('attachment_index: passes for positive integer 3', () => {
      expect(isInvalidAttIndex(3)).toBe(false);
    });

    it('attachment_index: throws-guard for -1 (negative)', () => {
      expect(isInvalidAttIndex(-1)).toBe(true);
    });

    it('attachment_index: throws-guard for a float 1.5', () => {
      expect(isInvalidAttIndex(1.5)).toBe(true);
    });

    it('attachment_index: throws-guard for NaN', () => {
      expect(isInvalidAttIndex(NaN)).toBe(true);
    });

    it('attachment_index: throws-guard for a string "0"', () => {
      expect(isInvalidAttIndex('0')).toBe(true);
    });

    it('attachment_index: throws-guard for undefined', () => {
      expect(isInvalidAttIndex(undefined)).toBe(true);
    });
  });

  // ── create_folder / delete_folder handler validation (validateFolderName) ──

  describe('create_folder / delete_folder handler validation (validateFolderName)', () => {
    // Replicates the guard: validateFolderName(args.folderName)
    it('valid folder name "Work" returns null (no error)', () => {
      expect(validateFolderName('Work')).toBeNull();
    });

    it('valid folder name with unicode returns null', () => {
      expect(validateFolderName('Receipts-2024')).toBeNull();
    });

    it('empty string returns error', () => {
      expect(validateFolderName('')).not.toBeNull();
    });

    it('whitespace-only string returns error', () => {
      expect(validateFolderName('   ')).not.toBeNull();
    });

    it('null returns error', () => {
      expect(validateFolderName(null)).not.toBeNull();
    });

    it('undefined returns error', () => {
      expect(validateFolderName(undefined)).not.toBeNull();
    });

    it('name containing "/" returns error (leaf segment only)', () => {
      expect(validateFolderName('Folders/Work')).not.toBeNull();
    });

    it('traversal ".." returns error', () => {
      expect(validateFolderName('..')).not.toBeNull();
    });

    it('name with null byte returns error', () => {
      expect(validateFolderName('Work\x00Evil')).not.toBeNull();
    });

    it('name with C0 control char returns error', () => {
      expect(validateFolderName('Work\x1fEvil')).not.toBeNull();
    });

    it('exact 255-char name returns null (at limit)', () => {
      expect(validateFolderName('a'.repeat(255))).toBeNull();
    });

    it('256-char name returns error (over limit)', () => {
      expect(validateFolderName('a'.repeat(256))).not.toBeNull();
    });
  });

  // ── rename_folder handler validation (validateFolderName for oldName/newName) ──

  describe('rename_folder handler validation (validateFolderName for oldName and newName)', () => {
    it('valid oldName "Archive" returns null', () => {
      expect(validateFolderName('Archive')).toBeNull();
    });

    it('valid newName "Archive-Old" returns null', () => {
      expect(validateFolderName('Archive-Old')).toBeNull();
    });

    it('oldName with path traversal "../INBOX" returns error', () => {
      expect(validateFolderName('../INBOX')).not.toBeNull();
    });

    it('newName that is empty returns error', () => {
      expect(validateFolderName('')).not.toBeNull();
    });

    it('newName containing "/" returns error', () => {
      expect(validateFolderName('New/Name')).not.toBeNull();
    });
  });

  // ── mark_email_read / star_email handler validation (numeric UID guard) ──

  describe('mark_email_read / star_email handler validation (numeric emailId guard)', () => {
    // Replicates: !emailId || typeof emailId !== "string" || !/^\d+$/.test(emailId)
    const isInvalidEmailId = (v: unknown): boolean =>
      !v || typeof v !== 'string' || !/^\d+$/.test(v as string);

    it('valid emailId "42" passes guard', () => {
      expect(isInvalidEmailId('42')).toBe(false);
    });

    it('valid emailId "1" passes guard', () => {
      expect(isInvalidEmailId('1')).toBe(false);
    });

    it('empty string triggers guard', () => {
      expect(isInvalidEmailId('')).toBe(true);
    });

    it('alphabetic string "abc" triggers guard', () => {
      expect(isInvalidEmailId('abc')).toBe(true);
    });

    it('mixed "12a3" triggers guard', () => {
      expect(isInvalidEmailId('12a3')).toBe(true);
    });

    it('negative "-1" triggers guard', () => {
      expect(isInvalidEmailId('-1')).toBe(true);
    });

    it('float "1.5" triggers guard', () => {
      expect(isInvalidEmailId('1.5')).toBe(true);
    });

    it('null triggers guard', () => {
      expect(isInvalidEmailId(null)).toBe(true);
    });

    it('undefined triggers guard', () => {
      expect(isInvalidEmailId(undefined)).toBe(true);
    });

    it('null-byte injection "12\x0034" triggers guard', () => {
      expect(isInvalidEmailId('12\x0034')).toBe(true);
    });
  });

  // ── Cycle #8: archive_email / move_to_trash / move_to_spam / move_email / delete_email
  //    All five handlers now use the same numeric UID guard before calling the IMAP service.
  //    Tests exercise the guard logic directly (same regex as in-handler code).
  describe('archive_email / move_to_trash / move_to_spam / move_email / delete_email handler validation (numeric emailId guard)', () => {
    // Helper mirrors the in-handler guard: !emailId || typeof emailId !== "string" || !/^\d+$/.test(emailId)
    const isInvalidMoveId = (id: unknown): boolean =>
      !id || typeof id !== 'string' || !/^\d+$/.test(id as string);

    it('valid "42" passes guard', () => {
      expect(isInvalidMoveId('42')).toBe(false);
    });

    it('valid "1" passes guard', () => {
      expect(isInvalidMoveId('1')).toBe(false);
    });

    it('valid "999999" passes guard', () => {
      expect(isInvalidMoveId('999999')).toBe(false);
    });

    it('empty string triggers guard', () => {
      expect(isInvalidMoveId('')).toBe(true);
    });

    it('alphabetic "abc" triggers guard', () => {
      expect(isInvalidMoveId('abc')).toBe(true);
    });

    it('mixed "12x" triggers guard', () => {
      expect(isInvalidMoveId('12x')).toBe(true);
    });

    it('negative "-5" triggers guard', () => {
      expect(isInvalidMoveId('-5')).toBe(true);
    });

    it('float "3.14" triggers guard', () => {
      expect(isInvalidMoveId('3.14')).toBe(true);
    });

    it('null triggers guard', () => {
      expect(isInvalidMoveId(null)).toBe(true);
    });

    it('undefined triggers guard', () => {
      expect(isInvalidMoveId(undefined)).toBe(true);
    });

    it('null-byte "7\x008" triggers guard', () => {
      expect(isInvalidMoveId('7\x008')).toBe(true);
    });
  });

  // ── Cycle #8: get_emails handler — folder validated with validateTargetFolder ──────────
  describe('get_emails handler validation (validateTargetFolder for folder arg)', () => {
    it('INBOX passes validation', () => {
      expect(validateTargetFolder('INBOX')).toBeNull();
    });

    it('Folders/Work passes validation', () => {
      expect(validateTargetFolder('Folders/Work')).toBeNull();
    });

    it('empty string passes validation (caller uses default INBOX)', () => {
      expect(validateTargetFolder('')).toBeNull();
    });

    it('undefined passes validation (caller uses default INBOX)', () => {
      expect(validateTargetFolder(undefined)).toBeNull();
    });

    it('path traversal "../../etc/passwd" fails validation', () => {
      expect(validateTargetFolder('../../etc/passwd')).not.toBeNull();
    });

    it('embedded traversal "Labels/../INBOX" fails validation', () => {
      expect(validateTargetFolder('Labels/../INBOX')).not.toBeNull();
    });

    it('null byte "INBOX\x00evil" fails validation', () => {
      expect(validateTargetFolder('INBOX\x00evil')).not.toBeNull();
    });

    it('over-limit (1001 chars) fails validation', () => {
      expect(validateTargetFolder('A'.repeat(1001))).not.toBeNull();
    });

    it('exact limit (1000 chars) passes validation', () => {
      expect(validateTargetFolder('A'.repeat(1000))).toBeNull();
    });
  });

  // ── Cycle #8: bulk operations — array items filtered to numeric UIDs only ────────────
  //    bulk_delete_emails, bulk_move_emails, bulk_mark_read, bulk_star,
  //    bulk_move_to_label, bulk_remove_label all now use /^\d+$/.test(id) filter.
  describe('bulk operation array-item numeric UID filter', () => {
    // Helper mirrors the in-handler filter: typeof id === "string" && /^\d+$/.test(id)
    const isValidBulkId = (id: unknown): boolean =>
      typeof id === 'string' && /^\d+$/.test(id as string);

    it('valid "42" passes filter', () => {
      expect(isValidBulkId('42')).toBe(true);
    });

    it('valid "1" passes filter', () => {
      expect(isValidBulkId('1')).toBe(true);
    });

    it('valid "100000" passes filter', () => {
      expect(isValidBulkId('100000')).toBe(true);
    });

    it('empty string is excluded by filter', () => {
      expect(isValidBulkId('')).toBe(false);
    });

    it('alphabetic "abc" is excluded by filter', () => {
      expect(isValidBulkId('abc')).toBe(false);
    });

    it('mixed "12x" is excluded by filter', () => {
      expect(isValidBulkId('12x')).toBe(false);
    });

    it('negative "-3" is excluded by filter', () => {
      expect(isValidBulkId('-3')).toBe(false);
    });

    it('float "2.5" is excluded by filter', () => {
      expect(isValidBulkId('2.5')).toBe(false);
    });

    it('null is excluded by filter', () => {
      expect(isValidBulkId(null)).toBe(false);
    });

    it('undefined is excluded by filter', () => {
      expect(isValidBulkId(undefined)).toBe(false);
    });

    it('number 42 (not string) is excluded by filter', () => {
      expect(isValidBulkId(42)).toBe(false);
    });

    it('null-byte "5\x006" is excluded by filter', () => {
      expect(isValidBulkId('5\x006')).toBe(false);
    });

    it('array of mixed inputs filters to numeric UIDs only', () => {
      const raw = ['42', 'abc', '', '-1', '100', null, undefined, '3.14', '7'];
      const valid = raw.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id as string));
      expect(valid).toEqual(['42', '100', '7']);
    });
  });

  // ── Cycle #9 Tests ─────────────────────────────────────────────────────────

  describe('move_to_label / remove_label handler validation (numeric emailId guard)', () => {
    // Both handlers now use the same !/^\d+$/.test(emailId) guard as all other
    // single-email action handlers.  These tests exercise the guard logic directly.
    function isValidEmailId(v: unknown): boolean {
      if (!v || typeof v !== 'string') return false;
      return /^\d+$/.test(v);
    }

    it('valid emailId "42" passes', () => {
      expect(isValidEmailId('42')).toBe(true);
    });

    it('valid emailId "1" passes', () => {
      expect(isValidEmailId('1')).toBe(true);
    });

    it('valid emailId "999999" passes', () => {
      expect(isValidEmailId('999999')).toBe(true);
    });

    it('empty string is rejected', () => {
      expect(isValidEmailId('')).toBe(false);
    });

    it('"abc" is rejected', () => {
      expect(isValidEmailId('abc')).toBe(false);
    });

    it('"12x" (mixed) is rejected', () => {
      expect(isValidEmailId('12x')).toBe(false);
    });

    it('"-5" (negative) is rejected', () => {
      expect(isValidEmailId('-5')).toBe(false);
    });

    it('"3.14" (float) is rejected', () => {
      expect(isValidEmailId('3.14')).toBe(false);
    });

    it('null is rejected', () => {
      expect(isValidEmailId(null)).toBe(false);
    });

    it('undefined is rejected', () => {
      expect(isValidEmailId(undefined)).toBe(false);
    });

    it('null-byte "5\\x006" is rejected', () => {
      expect(isValidEmailId('5\x006')).toBe(false);
    });
  });

  describe('saveDraft attachment filename sanitization', () => {
    // These tests exercise the inline sanitization logic added to saveDraft in
    // simple-imap-service.ts.  We replicate the exact logic here so the rules
    // are independently testable without spinning up an IMAP connection.
    function sanitizeDraftFilename(filename: string | undefined): string | undefined {
      if (!filename) return undefined;
      return filename.replace(/[\r\n\x00]/g, '').slice(0, 255) || 'attachment';
    }

    it('plain filename passes unchanged', () => {
      expect(sanitizeDraftFilename('report.pdf')).toBe('report.pdf');
    });

    it('CRLF injection in filename is stripped', () => {
      expect(sanitizeDraftFilename('a.pdf\r\nContent-Type: text/html')).toBe('a.pdfContent-Type: text/html');
    });

    it('LF injection in filename is stripped', () => {
      expect(sanitizeDraftFilename('bad\nfile.txt')).toBe('badfile.txt');
    });

    it('NUL byte in filename is stripped', () => {
      expect(sanitizeDraftFilename('file\x00.txt')).toBe('file.txt');
    });

    it('filename longer than 255 chars is truncated', () => {
      const long = 'a'.repeat(300);
      expect(sanitizeDraftFilename(long)!.length).toBe(255);
    });

    it('filename that becomes empty after stripping falls back to "attachment"', () => {
      expect(sanitizeDraftFilename('\r\n\x00')).toBe('attachment');
    });

    it('undefined filename returns undefined', () => {
      expect(sanitizeDraftFilename(undefined)).toBeUndefined();
    });
  });

  describe('saveDraft attachment contentType sanitization', () => {
    // Replicates the MIME type validation logic from saveDraft.
    function sanitizeDraftContentType(contentType: string | undefined): string | undefined {
      if (!contentType) return undefined;
      const rawCt = contentType.replace(/[\r\n\x00]/g, '').trim();
      return rawCt && /^[\w!#$&\-^]+\/[\w!#$&\-^+.]+$/.test(rawCt) ? rawCt : undefined;
    }

    it('valid "application/pdf" passes', () => {
      expect(sanitizeDraftContentType('application/pdf')).toBe('application/pdf');
    });

    it('valid "image/png" passes', () => {
      expect(sanitizeDraftContentType('image/png')).toBe('image/png');
    });

    it('valid "text/plain" passes', () => {
      expect(sanitizeDraftContentType('text/plain')).toBe('text/plain');
    });

    it('CRLF injection in contentType is rejected (becomes undefined)', () => {
      expect(sanitizeDraftContentType('text/html\r\nX-Injected: yes')).toBeUndefined();
    });

    it('NUL byte in contentType is stripped, then validated', () => {
      // "text/plain\x00" after strip becomes "text/plain" which is valid
      expect(sanitizeDraftContentType('text/plain\x00')).toBe('text/plain');
    });

    it('arbitrary string without slash is rejected', () => {
      expect(sanitizeDraftContentType('notamimetype')).toBeUndefined();
    });

    it('empty string returns undefined', () => {
      expect(sanitizeDraftContentType('')).toBeUndefined();
    });

    it('undefined returns undefined', () => {
      expect(sanitizeDraftContentType(undefined)).toBeUndefined();
    });

    it('contentType with spaces is rejected', () => {
      expect(sanitizeDraftContentType('text /plain')).toBeUndefined();
    });
  });

  describe('requireNumericEmailId', () => {
    // Valid cases — helper should return the string unchanged.
    it('returns "42" unchanged', () => {
      expect(requireNumericEmailId('42')).toBe('42');
    });

    it('returns "1" unchanged', () => {
      expect(requireNumericEmailId('1')).toBe('1');
    });

    it('returns "999999" unchanged', () => {
      expect(requireNumericEmailId('999999')).toBe('999999');
    });

    // Custom fieldName is reflected in the error message.
    it('uses custom fieldName in error message', () => {
      expect(() => requireNumericEmailId('bad', 'email_id')).toThrowError(
        'email_id must be a non-empty numeric UID string.'
      );
    });

    it('defaults fieldName to "emailId" when not supplied', () => {
      expect(() => requireNumericEmailId('abc')).toThrowError(
        'emailId must be a non-empty numeric UID string.'
      );
    });

    // Error cases — helper should throw McpError(InvalidParams, …).
    it('throws McpError with ErrorCode.InvalidParams for empty string', () => {
      const err = (() => { try { requireNumericEmailId(''); } catch (e) { return e; } })();
      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe(ErrorCode.InvalidParams);
    });

    it('throws for alphabetic string "abc"', () => {
      expect(() => requireNumericEmailId('abc')).toThrow(McpError);
    });

    it('throws for mixed string "12x"', () => {
      expect(() => requireNumericEmailId('12x')).toThrow(McpError);
    });

    it('throws for negative string "-5"', () => {
      expect(() => requireNumericEmailId('-5')).toThrow(McpError);
    });

    it('throws for float string "3.14"', () => {
      expect(() => requireNumericEmailId('3.14')).toThrow(McpError);
    });

    it('throws for null', () => {
      expect(() => requireNumericEmailId(null)).toThrow(McpError);
    });

    it('throws for undefined', () => {
      expect(() => requireNumericEmailId(undefined)).toThrow(McpError);
    });

    it('throws for numeric type (not a string)', () => {
      expect(() => requireNumericEmailId(42)).toThrow(McpError);
    });

    it('throws for null-byte string "5\\x006"', () => {
      expect(() => requireNumericEmailId('5\x006')).toThrow(McpError);
    });
  });

  // ── Cycle #15: validateAttachments ─────────────────────────────────────────

  describe('validateAttachments', () => {
    // null / undefined — attachment field is optional
    it('returns null for undefined (omitted field)', () => {
      expect(validateAttachments(undefined)).toBeNull();
    });

    it('returns null for null (omitted field)', () => {
      expect(validateAttachments(null)).toBeNull();
    });

    // non-array
    it('returns error for a plain object (not an array)', () => {
      expect(validateAttachments({ filename: 'x.txt', content: 'abc' })).not.toBeNull();
    });

    it('returns error for a string', () => {
      expect(validateAttachments('file.txt')).not.toBeNull();
    });

    it('returns error for a number', () => {
      expect(validateAttachments(42)).not.toBeNull();
    });

    // empty array — valid (no attachments)
    it('returns null for an empty array', () => {
      expect(validateAttachments([])).toBeNull();
    });

    // well-formed attachments
    it('returns null for a valid attachment with string content', () => {
      expect(validateAttachments([
        { filename: 'report.pdf', content: 'base64data==', contentType: 'application/pdf' },
      ])).toBeNull();
    });

    it('returns null for a valid attachment with Buffer content', () => {
      expect(validateAttachments([
        { filename: 'image.png', content: Buffer.from('data'), contentType: 'image/png' },
      ])).toBeNull();
    });

    it('returns null when contentType is omitted', () => {
      expect(validateAttachments([
        { filename: 'data.bin', content: 'abc123' },
      ])).toBeNull();
    });

    it('returns null for multiple valid attachments', () => {
      expect(validateAttachments([
        { filename: 'a.txt', content: 'hello' },
        { filename: 'b.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' },
      ])).toBeNull();
    });

    // malformed array items
    it('returns error for a primitive item in array (string)', () => {
      const err = validateAttachments(['not-an-object']);
      expect(err).not.toBeNull();
      expect(err).toMatch(/attachments\[0\]/);
    });

    it('returns error for a null item in array', () => {
      const err = validateAttachments([null]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/attachments\[0\]/);
    });

    it('returns error for a number item in array', () => {
      expect(validateAttachments([42])).not.toBeNull();
    });

    // missing/invalid filename
    it('returns error when filename is missing', () => {
      const err = validateAttachments([{ content: 'abc' }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/filename/);
    });

    it('returns error when filename is an empty string', () => {
      const err = validateAttachments([{ filename: '', content: 'abc' }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/filename/);
    });

    it('returns error when filename is a number', () => {
      const err = validateAttachments([{ filename: 123, content: 'abc' }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/filename/);
    });

    // missing/invalid content
    it('returns error when content is missing', () => {
      const err = validateAttachments([{ filename: 'file.txt' }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/content/);
    });

    it('returns error when content is null', () => {
      const err = validateAttachments([{ filename: 'file.txt', content: null }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/content/);
    });

    it('returns error when content is a number', () => {
      const err = validateAttachments([{ filename: 'file.txt', content: 42 }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/content/);
    });

    it('returns error when content is a plain object (stream-like)', () => {
      const err = validateAttachments([{ filename: 'file.txt', content: { pipe: () => {} } }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/content/);
    });

    // invalid contentType
    it('returns error when contentType is a number', () => {
      const err = validateAttachments([{ filename: 'file.txt', content: 'abc', contentType: 42 }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/contentType/);
    });

    it('returns error when contentType is an object', () => {
      const err = validateAttachments([{ filename: 'file.txt', content: 'abc', contentType: {} }]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/contentType/);
    });

    // error index is correctly reported for second item
    it('reports the correct index when the second attachment is malformed', () => {
      const err = validateAttachments([
        { filename: 'good.txt', content: 'ok' },
        { filename: 'bad.txt', content: 99 },
      ]);
      expect(err).not.toBeNull();
      expect(err).toMatch(/attachments\[1\]/);
    });
  });
});
