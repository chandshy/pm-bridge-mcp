/**
 * Canonical seed emails for E2E scenarios.
 *
 * Each scenario file picks the subset it needs and APPENDs via ImapFixtures.
 * Keeping them centralized makes assertions (subject matches, sender counts)
 * stable across files.
 */

import type { SeedEmail } from "../support/mime-builder.js";

export const PROMO_CREDIT_KARMA: SeedEmail = {
  from: "no-reply@creditkarma.com",
  to: "alice@test.local",
  subject: "Your credit score update",
  body: "Your credit score is now 750. Tap to review changes.",
  date: new Date("2026-05-01T10:00:00Z"),
};

export const PROMO_RED_LOBSTER: SeedEmail = {
  from: "specials@redlobster.com",
  to: "alice@test.local",
  subject: "Endless Shrimp is back",
  body: "Limited time. Visit your nearest Red Lobster.",
  date: new Date("2026-05-02T11:00:00Z"),
};

export const NEWSLETTER_TOKEN_DISPATCH: SeedEmail = {
  from: "newsletter@tokendispatch.com",
  to: "alice@test.local",
  subject: "Token Dispatch — Weekly digest",
  body: "This week in crypto: a long-winded roundup.",
  date: new Date("2026-05-03T12:00:00Z"),
};

export const RELEASE_NVIDIA: SeedEmail = {
  from: "releases@nvidia.com",
  to: "alice@test.local",
  subject: "NVIDIA CUDA 13 is released",
  body: "Read the release notes at developer.nvidia.com.",
  date: new Date("2026-05-04T13:00:00Z"),
};

export const PROMO_BATCH: SeedEmail[] = [
  PROMO_CREDIT_KARMA,
  PROMO_RED_LOBSTER,
  NEWSLETTER_TOKEN_DISPATCH,
  RELEASE_NVIDIA,
];

export const WORK_THREAD_ROOT: SeedEmail = {
  from: "manager@test.local",
  to: "alice@test.local",
  subject: "Q2 planning",
  body: "Could you put together a doc for Q2 priorities?",
  date: new Date("2026-05-05T09:00:00Z"),
  messageId: "thread-root-q2",
};

export const WORK_THREAD_REPLY: SeedEmail = {
  from: "alice@test.local",
  to: "manager@test.local",
  subject: "Re: Q2 planning",
  body: "Sure — I'll have a draft by Friday.",
  date: new Date("2026-05-05T10:00:00Z"),
  messageId: "thread-reply-q2",
  inReplyTo: "<thread-root-q2@test.local>",
  references: "<thread-root-q2@test.local>",
};

export const PERSONAL_MOM: SeedEmail = {
  from: "mom@family.test",
  to: "alice@test.local",
  subject: "Dinner this weekend?",
  body: "Are you free Saturday?",
  date: new Date("2026-05-06T15:00:00Z"),
};
