import { z } from "zod";
import { paginated, pageQuerySchema } from "./pagination";
import { waitlistInviteModes, waitlistStatuses } from "./waitlist";

/* --------------------------------------------------------------------------
   The waitlist, as staff see it.

   The storefront's waitlist contract is a write-only door: someone posts
   their name and gets an id back. Everything here is the other half — the
   list that door has been filling, and the two actions that make its
   lifecycle columns mean anything.

   Note what the customer's `waitlistEntrySchema` deliberately does not echo
   back (phone, email) is exactly what a row here leads with. That is not an
   inconsistency: the customer already knows their own phone number, and the
   whole purpose of this view is being able to reach them.
   -------------------------------------------------------------------------- */

/**
 * How the list is sorted. Oldest-first by default, unlike the order queue.
 *
 * A waitlist is a queue in the fairness sense rather than the work sense: the
 * person who signed up first was promised, in the page's own words, to be
 * "first in line" — so the default order is the order stock should be offered
 * in. Newest-first is the exception here, not the rule.
 */
export const adminWaitlistSorts = ["oldest", "recent", "quantity-desc"] as const;

export type AdminWaitlistSort = (typeof adminWaitlistSorts)[number];

/**
 * Narrow the list by what happened to the entry's invite token, rather than
 * by its status.
 *
 * `status` cannot answer this on its own. A NOTIFIED entry is one that was
 * *reached*, which says nothing about whether the link it was sent has been
 * spent — and the entries staff most need to find after a restock are exactly
 * the ones where those two diverge: texted, never ordered. Reading it off
 * `inviteUsedAt`/`inviteExpiresAt` makes that a filter instead of a manual
 * scan.
 *
 *   unused    a token was issued and has not been redeemed. Includes links
 *             that are still live.
 *   expired   the same, narrowed to links whose window has already closed —
 *             the ones where re-inviting is the only way back in.
 *
 * There is deliberately no "used" member: an entry whose token was spent is
 * already CONVERTED, and the status filter says that more plainly.
 */
export const adminWaitlistInviteStates = ["unused", "expired"] as const;

export type AdminWaitlistInviteState = (typeof adminWaitlistInviteStates)[number];

export const adminWaitlistQuerySchema = pageQuerySchema({ defaultPageSize: 50 }).extend({
  /**
   * Repeatable, same `preprocess` reason as the order queue's: one occurrence
   * arrives as a string, two as an array, and a schema accepting only one of
   * those breaks in whichever case went untested.
   */
  status: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(waitlistStatuses)),
    )
    .optional(),

  /** Free text over name, email and phone — whatever the customer quoted. */
  q: z.string().trim().min(1).max(120).optional(),

  /** Exact match on the entry point, e.g. "restock-notify-page". */
  source: z.string().trim().min(1).max(64).optional(),

  /** Narrow the list to one title's queue — what makes "first in line for
   *  this book" a filter rather than a manual scroll through everyone. */
  bookId: z.string().uuid().optional(),

  /** Exact match on the submission language, so an SMS blast can go out one
   *  language at a time rather than needing a translator per batch. */
  locale: z.string().trim().min(2).max(12).optional(),

  /** See `adminWaitlistInviteStates`. Absent means "don't filter on the
   *  token at all", which is every screen except the re-invite tab. */
  inviteState: z.enum(adminWaitlistInviteStates).optional(),

  /** Inclusive date bounds on when they signed up. ISO-8601 dates. */
  signedFrom: z.iso.date().optional(),
  signedTo: z.iso.date().optional(),

  sort: z.enum(adminWaitlistSorts).default("oldest"),
});

export type AdminWaitlistQuery = z.infer<typeof adminWaitlistQuerySchema>;

/**
 * One row.
 *
 * `internalNote` is sent in full, unlike the order queue which sends only a
 * `hasInternalNote` flag. The order queue can afford the flag because there
 * is a detail page to open; a waitlist entry has no detail page and never
 * needs one — the row *is* the record — so a note nobody can read would be a
 * note nobody writes.
 */
export const adminWaitlistEntrySchema = z.object({
  id: z.string().uuid(),

  /** The title they were waiting on, or null for the shop-wide list. Reads
   *  from the snapshot, so it survives the book being renamed or delisted. */
  bookTitle: z.string().nullable(),

  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  quantity: z.number().int().positive(),
  locale: z.string(),
  source: z.string(),

  status: z.enum(waitlistStatuses),
  /** When the restock alert actually went out. Null until it has. */
  notifiedAt: z.string().nullable(),
  /** The order this signup became, if it has. Null otherwise — nothing sets
   *  this yet; see the note on conversion tracking in the admin service. */
  convertedOrderNumber: z.string().nullable(),
  internalNote: z.string().nullable(),

  /**
   * How the last invite text went, or null if this entry has never been sent
   * one.
   *
   * Deliberately separate from `status`/`notifiedAt`, which answer "has this
   * person been reached, ever" and only move forward. This answers the
   * retryable question a restock morning asks — did *that* send get through —
   * and it is what lets staff re-text the three that failed instead of all
   * twenty. Read from the database rather than from the invite response, so
   * it survives the request that produced it.
   */
  inviteSms: z
    .object({
      status: z.enum(["SENT", "FAILED"]),
      /** The gateway's complaint, truncated. Null on a successful send. */
      error: z.string().nullable(),
      at: z.string(),
    })
    .nullable(),

  /**
   * The invite token's own state, or null if this entry has never had one.
   *
   * Distinct from `inviteSms` above, which answers "did the text leave the
   * gateway". This answers what became of the link inside it — still live,
   * lapsed, or spent — which is the question the re-invite tab is built on
   * and the one nothing else on the row can answer.
   *
   * The token itself is never sent: it is a bearer credential for placing
   * somebody else's order, and no admin screen needs it. Only its lifecycle.
   */
  invite: z
    .object({
      mode: z.enum(waitlistInviteModes),
      expiresAt: z.string(),
      /** When it was spent. Null while the link is still redeemable. */
      usedAt: z.string().nullable(),
    })
    .nullable(),

  signedUpAt: z.string(),
});

export type AdminWaitlistEntry = z.infer<typeof adminWaitlistEntrySchema>;

/**
 * How many entries sit in each status.
 *
 * Computed against every active filter *except* `status`, so the tabs read as
 * "how many of my current search are pending" rather than as a table-wide
 * constant that ignores the search box above it. With no filters applied it
 * is the whole-table answer, which is the "234 pending, 40 notified" line the
 * screen leads with.
 */
export const adminWaitlistCountsSchema = z.object({
  PENDING: z.number().int().nonnegative(),
  NOTIFIED: z.number().int().nonnegative(),
  CONVERTED: z.number().int().nonnegative(),
  CANCELLED: z.number().int().nonnegative(),
});

export type AdminWaitlistCounts = z.infer<typeof adminWaitlistCountsSchema>;

export const adminWaitlistListSchema = paginated(adminWaitlistEntrySchema).extend({
  counts: adminWaitlistCountsSchema,
  /** Sum of `quantity` across every entry matching the current filters
   *  (not just the current page) — how many books the waiting list wants. */
  totalQuantity: z.number().int().nonnegative(),
  /** Every distinct `source` present in the table, for the filter dropdown.
   *  Read from the data rather than from a constant, because `source` is free
   *  text on purpose — a new entry point must not need a deploy to be
   *  filterable. */
  sources: z.array(z.string()),
});

export type AdminWaitlistList = z.infer<typeof adminWaitlistListSchema>;

/**
 * Mark a batch as notified.
 *
 * Ids rather than "everything matching the current filter", which is the
 * shape that invites an accidental mark-the-whole-table. The panel sends the
 * rows it has checked, so what staff selected on screen is exactly what the
 * server acts on.
 */
export const adminWaitlistNotifyRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one entry.").max(500),
});

export type AdminWaitlistNotifyRequest = z.infer<typeof adminWaitlistNotifyRequestSchema>;

export const adminWaitlistNotifyResultSchema = z.object({
  /** How many rows actually moved. Lower than `ids.length` when some were
   *  already notified — see the service for why that is not an error. */
  updated: z.number().int().nonnegative(),
  notifiedAt: z.string(),
});

export type AdminWaitlistNotifyResult = z.infer<typeof adminWaitlistNotifyResultSchema>;

/**
 * Edit one entry. Both fields optional, at least one required — a PATCH with
 * an empty body is a request that means nothing, and silently returning the
 * unchanged row would hide a broken caller.
 */
export const adminWaitlistUpdateRequestSchema = z
  .object({
    status: z.enum(waitlistStatuses).optional(),
    /** Empty string clears the note; null would need every caller to
     *  distinguish "clear it" from "leave it alone", which is what `undefined`
     *  already says. */
    internalNote: z.string().max(2000).optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.internalNote !== undefined,
    "Send a status, a note, or both.",
  );

export type AdminWaitlistUpdateRequest = z.infer<typeof adminWaitlistUpdateRequestSchema>;

/* --------------------------------------------------------------------------
   Inviting: mint a token per entry and text it out. Same ids-in-a-batch shape
   as `notify` above, and the same request also covers a single-row send — the
   panel's per-row "Invite" button just sends one id.
   -------------------------------------------------------------------------- */

export const adminWaitlistInviteRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least one entry.").max(500),
});

export type AdminWaitlistInviteRequest = z.infer<typeof adminWaitlistInviteRequestSchema>;

/** One entry's outcome. `sent: false` covers both "not eligible" (already
 *  converted or cancelled) and "the gateway call failed" — `error` says which. */
export const adminWaitlistInviteOutcomeSchema = z.object({
  id: z.string().uuid(),
  sent: z.boolean(),
  mode: z.enum(waitlistInviteModes).nullable(),
  expiresAt: z.string().nullable(),
  error: z.string().optional(),
});

export type AdminWaitlistInviteOutcome = z.infer<typeof adminWaitlistInviteOutcomeSchema>;

export const adminWaitlistInviteResultSchema = z.object({
  results: z.array(adminWaitlistInviteOutcomeSchema),
  invitedAt: z.string(),
});

export type AdminWaitlistInviteResult = z.infer<typeof adminWaitlistInviteResultSchema>;

/* --------------------------------------------------------------------------
   How long an issued invite stays redeemable — shop configuration, same
   "singleton settings row" home as the SMS SIM choice (see admin-sms.ts).
   -------------------------------------------------------------------------- */

/** "customer" defers to whatever locale the waitlist entry was submitted
 *  under; "en"/"bn" pin every invite to that language regardless. */
export const waitlistInviteLanguages = ["en", "bn", "customer"] as const;
export type WaitlistInviteLanguage = (typeof waitlistInviteLanguages)[number];

export const adminWaitlistInviteSettingsSchema = z.object({
  /** Null → WaitlistInviteSettingsService's own default (48 hours). */
  ttlHours: z.number().int().min(1).max(720).nullable(),
  /** Null → WaitlistInviteSettingsService's own default ("customer"). */
  language: z.enum(waitlistInviteLanguages).nullable(),
  updatedAt: z.string().nullable(),
  updatedByEmail: z.string().nullable(),
});

export type AdminWaitlistInviteSettings = z.infer<typeof adminWaitlistInviteSettingsSchema>;

export const adminWaitlistInviteSettingsUpdateSchema = z.object({
  ttlHours: z
    .number()
    .int()
    .min(1, "Enter at least 1 hour.")
    .max(720, "Keep it under 720 hours (30 days)."),
  language: z.enum(waitlistInviteLanguages),
});

export type AdminWaitlistInviteSettingsUpdate = z.infer<
  typeof adminWaitlistInviteSettingsUpdateSchema
>;
