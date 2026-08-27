import { z } from "zod";
import { paginated, pageQuerySchema } from "./pagination";
import { waitlistStatuses } from "./waitlist";

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

  /** Exact match on the submission language, so an SMS blast can go out one
   *  language at a time rather than needing a translator per batch. */
  locale: z.string().trim().min(2).max(12).optional(),

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
