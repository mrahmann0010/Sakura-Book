import { z } from "zod";

/* --------------------------------------------------------------------------
   Testimonials — what a visitor says about the platform.

   About the shop and its service: ordering, delivery, payment, support, the
   experience of buying here. Not about a book. There is deliberately no
   `bookId` anywhere in this file, and adding one later would not be a new
   field — it would be a second thing this table means, and the moment it has
   two meanings every read has to say which one it wants.

   Per-title reviews are a separate concern with a separate home: `book_reviews`
   already exists for them, and backs the catalog's `rating` / `ratingCount`.
   Nothing here feeds those.

   There are no accounts. Everything is guest-submitted, which is why the
   author fields are plain strings rather than a customer id, and why the
   server records spam signals at all.

   Validation messages state the fix rather than the fault, per checkout.ts's
   rule, and stay English for the same reason: the API ships one language and
   clients render from `code` + `path`.
   -------------------------------------------------------------------------- */

/**
 * A testimonial's moderation state.
 *
 * `PENDING` is where every public submission lands and nothing else is ever
 * created as. `REJECTED` and `SPAM` are distinct on purpose — declining to
 * publish a real person's real opinion and binning a bot are different acts,
 * and collapsing them would make "how much spam are we actually getting"
 * unanswerable.
 */
export const reviewStatuses = ["PENDING", "APPROVED", "REJECTED", "SPAM"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

/**
 * The shortest testimonial worth publishing, and the longest worth reading.
 *
 * The floor is the load-bearing one: it is what stops the queue filling with
 * "good" and "nice service", which are indistinguishable from spam and add
 * nothing to a page. Shared with the client so the form can say so before a
 * round trip.
 */
export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 2000;

/* --------------------------------------------------------------------------
   Submitting
   -------------------------------------------------------------------------- */

/**
 * What the public form may send. Four fields, one of them required.
 *
 * Optionality here is a product decision, not laxity: someone willing to write
 * two sentences about their delivery should not be turned away for declining
 * to type their name, and plenty of people have something to say without
 * wanting to score it out of five.
 *
 * Note what is *absent*: `status`, `isFeatured`, `isVerified`, `publishedAt`.
 * Those are the server's and the moderator's, and the global ValidationPipe
 * runs with `whitelist`, so a client sending `{"status":"APPROVED"}` has the
 * field stripped rather than honoured.
 */
export const reviewSubmitRequestSchema = z.object({
  /** How they want to be credited. Absent renders as "Anonymous". */
  authorName: z.string().trim().min(1).max(80).optional(),

  /**
   * Never published, never echoed back — see `reviewSchema`. Collected so a
   * moderator can reply to a complaint, and so a future post-delivery invite
   * has something to match an order against.
   */
  authorEmail: z
    .string()
    .trim()
    .max(254)
    .email("Use an address like you@example.com, or leave it blank.")
    .optional(),

  /** Their rating of the service, if they want to give one. Not a book's. */
  rating: z
    .number()
    .int("Choose a whole number of stars.")
    .min(1, "Choose between 1 and 5 stars.")
    .max(5, "Choose between 1 and 5 stars.")
    .optional(),

  title: z.string().trim().min(1).max(120).optional(),

  body: z
    .string()
    .trim()
    .min(REVIEW_BODY_MIN, "Write at least a sentence or two — a few words is not much help.")
    .max(REVIEW_BODY_MAX, "Keep it under 2000 characters."),

  /**
   * The honeypot. A real browser never fills a hidden field; a form-scraping
   * bot fills every input it finds. Named `website` because that is what the
   * bots are looking for, and typed as "must be empty" so a filled one fails
   * validation loudly in development while the server drops it silently in
   * production — see ReviewsService.submit.
   */
  website: z.string().max(0).optional(),
});

export type ReviewSubmitRequest = z.infer<typeof reviewSubmitRequestSchema>;

/**
 * The acknowledgement. Deliberately not the testimonial itself.
 *
 * Nothing is public until a moderator approves it, so returning the row would
 * invite a client to render what it just posted as though it were live. The
 * `status` is echoed precisely so the form can say "waiting for approval"
 * rather than "published", which is the difference between a visitor
 * submitting once and submitting four times.
 */
export const reviewSubmissionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(reviewStatuses),
});

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

/* --------------------------------------------------------------------------
   Reading
   -------------------------------------------------------------------------- */

/**
 * One published testimonial, as the storefront renders it.
 *
 * `authorEmail`, `ipHash` and the moderator's note have no representation here
 * at all. That is the enforcement: the mapper builds this shape field by field,
 * so a column added to the table cannot reach a page because someone forgot
 * which fields were private — the same argument book.mapper.ts makes.
 *
 * `authorName` stays nullable rather than being defaulted to "Anonymous" on
 * the server: it is a display string, three locales render it, and the word
 * "Anonymous" is not the same word in all of them.
 */
export const reviewSchema = z.object({
  id: z.string().uuid(),
  authorName: z.string().nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  title: z.string().nullable(),
  body: z.string(),
  /** Staff-set, and only ever by hand: this shop has no automatic link from a
   *  testimonial to an order yet. See the column comment. */
  isVerified: z.boolean(),
  /** When it was approved — the sort key, and what a client should date it by.
   *  Never `createdAt`: a testimonial held in the queue for a week would
   *  otherwise appear a week old the moment it went live. */
  publishedAt: z.string(),
});

export type Review = z.infer<typeof reviewSchema>;
