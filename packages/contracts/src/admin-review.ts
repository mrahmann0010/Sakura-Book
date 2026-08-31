import { z } from "zod";
import { paginated, pageQuerySchema } from "./pagination";
import { reviewStatuses } from "./review";

/* --------------------------------------------------------------------------
   Testimonials, as staff see them.

   Same split as admin-waitlist.ts: the storefront's review contract is a
   write-only door plus a published-only read, and everything here is the
   moderation queue behind it.

   What a row leads with here is exactly what `reviewSchema` refuses to
   expose — the email, the moderator's note, the spam signals. That is not an
   inconsistency, it is the whole reason this file is separate.
   -------------------------------------------------------------------------- */

export const adminReviewSorts = ["recent", "oldest", "rating-desc", "rating-asc"] as const;
export type AdminReviewSort = (typeof adminReviewSorts)[number];

export const adminReviewQuerySchema = pageQuerySchema({ defaultPageSize: 50 }).extend({
  /**
   * Repeatable, same `preprocess` as the waitlist's: one occurrence arrives as
   * a string, two as an array, and a schema accepting only one of those breaks
   * in whichever case went untested.
   */
  status: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(reviewStatuses)),
    )
    .optional(),

  /** Free text over the name, the email, the title and the body. */
  q: z.string().trim().min(1).max(200).optional(),

  /** Only the hand-picked ones, for building the home page strip. */
  isFeatured: z.coerce.boolean().optional(),

  /** Inclusive date bounds on when it was submitted. ISO-8601 dates. */
  submittedFrom: z.iso.date().optional(),
  submittedTo: z.iso.date().optional(),

  /** Newest first: unlike the waitlist, this is a work queue, not a fair one. */
  sort: z.enum(adminReviewSorts).default("recent"),
});

export type AdminReviewQuery = z.infer<typeof adminReviewQuerySchema>;

/**
 * One row in the queue: everything the submitter sent, plus everything the
 * server recorded about the submission.
 *
 * `ipHash` travels rather than the address itself, and it travels at all only
 * because it is the one way to see "these nine reviews came from one place"
 * without the panel ever handling an IP. It is a 64-character hex string with
 * no meaning except equality.
 */
export const adminReviewSchema = z.object({
  id: z.string().uuid(),

  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  title: z.string().nullable(),
  body: z.string(),

  status: z.enum(reviewStatuses),
  isFeatured: z.boolean(),
  isVerified: z.boolean(),
  /** The order a moderator linked by hand, if any — what backs the verified
   *  badge. The number, not the id: it is what staff can search on. */
  orderNumber: z.string().nullable(),
  moderatorNote: z.string().nullable(),

  publishedAt: z.string().nullable(),
  submittedAt: z.string(),

  ipHash: z.string().nullable(),
  userAgent: z.string().nullable(),
});

export type AdminReview = z.infer<typeof adminReviewSchema>;

/** Per-status totals for the queue's tabs. */
export const adminReviewCountsSchema = z.object({
  PENDING: z.number().int().nonnegative(),
  APPROVED: z.number().int().nonnegative(),
  REJECTED: z.number().int().nonnegative(),
  SPAM: z.number().int().nonnegative(),
});

export type AdminReviewCounts = z.infer<typeof adminReviewCountsSchema>;

export const adminReviewListSchema = paginated(adminReviewSchema).extend({
  /** Counts under the current filters *ignoring* the status filter, so the
   *  tabs count the search rather than the table — see the waitlist's. */
  counts: adminReviewCountsSchema,
});

export type AdminReviewList = z.infer<typeof adminReviewListSchema>;

/**
 * Moderating one testimonial. Every field optional; absent means "leave it".
 *
 * Not here: `body`, `title`, `authorName`. A moderator may decline to publish
 * a testimonial, but must not rewrite what someone said and then publish the
 * result under their name.
 */
export const adminReviewUpdateRequestSchema = z
  .object({
    status: z.enum(reviewStatuses).optional(),
    isFeatured: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    /** The order backing a verified badge. Null clears the link. */
    orderNumber: z.string().trim().max(32).nullable().optional(),
    /** Empty string clears it — a note trimmed to nothing is not a note. */
    moderatorNote: z.string().max(2000).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Change at least one field.",
  });

export type AdminReviewUpdateRequest = z.infer<typeof adminReviewUpdateRequestSchema>;
