import { boolean, check, index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { reviewStatusEnum } from "../enums";
import { orders } from "../orders/order";
import { timestamps } from "../timestamps";

/**
 * What customers say about the platform, and the moderation queue they arrive
 * in.
 *
 * ## About the service, not about a book
 *
 * Ordering, delivery, payment, support — the experience of buying here. There
 * is no `book_id`, deliberately: a testimonial that could optionally be about
 * a title is a table with two meanings, and every read then has to say which
 * one it wants. Per-title reviews already have a home in `book_reviews`, which
 * is what backs the catalog's `rating` / `ratingCount`.
 *
 * Nothing in this table feeds a book's displayed star average, and no query
 * that reads one was changed to add it. A `rating` here is one customer's
 * score for the service, shown beside their words or not at all.
 *
 * It lives in `marketing/` next to `waitlist-entry.ts` for that reason — it is
 * not catalog data.
 *
 * ## No accounts
 *
 * There is no customer table to join to, so the author is three optional
 * strings the submitter typed. `author_email` is the only PII here and is
 * never returned by a public endpoint — `reviewSchema` has no field for it,
 * and the mapper builds that shape explicitly so a column added here cannot
 * reach a page by accident.
 *
 * ## Nothing is public until it is approved
 *
 * Every public submission is created `PENDING` with `published_at` null. The
 * storefront reads `status = 'APPROVED'`, and the check constraint below makes
 * "approved" and "has a publish date" the same fact rather than two that can
 * drift — an approved row with a null `published_at` is invisible on the page
 * it was approved for, while reading as live in the queue.
 */
export const initialReviews = pgTable(
  "initial_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /* ---- submitted by the visitor ---- */

    /** As they asked to be credited. Null renders as "Anonymous" — by the
     *  client, in its own language; see the contract. */
    authorName: varchar("author_name", { length: 80 }),

    /** PRIVATE. Never in a public response. Collected so a moderator can reply
     *  to a complaint, and so a future post-delivery invite has something to
     *  match an order against. */
    authorEmail: varchar("author_email", { length: 254 }),

    /**
     * Their score for the service, 1-5 whole stars, or null.
     *
     * Nullable because plenty of people have something worth publishing
     * without wanting to score it, and a text-only testimonial is a normal
     * row here rather than an edge case. Anything that ever averages these
     * must therefore exclude nulls itself.
     */
    rating: integer("rating"),

    title: varchar("title", { length: 120 }),

    /** The testimonial itself, and the only thing a submission cannot be
     *  without. */
    body: text("body").notNull(),

    /* ---- set by the server or a moderator ---- */

    status: reviewStatusEnum("status").notNull().default("PENDING"),

    /** Hand-picked for the home page strip. */
    isFeatured: boolean("is_featured").notNull().default(false),

    /**
     * Shows a "verified customer" badge. Set by hand, always.
     *
     * There is no automatic link from a testimonial to an order — matching on
     * email would be wrong for a household sharing an address, and the form
     * does not require an email at all. The column and the badge are ready for
     * the day a post-delivery invite carries a signed order token; until then
     * a moderator who recognises the order sets it, and the claim stays true
     * because a person made it.
     */
    isVerified: boolean("is_verified").notNull().default(false),

    /** The order backing that badge, when a moderator identified one.
     *  onDelete "set null" — removing an order must not take the testimonial,
     *  which is about the service and stands on its own. */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),

    /** Staff-only: why it was rejected, who chased it up. Never shown. */
    moderatorNote: text("moderator_note"),

    /** Stamped on approval. The public sort key — never `created_at`, or a
     *  testimonial held in the queue for a week appears a week old the moment
     *  it goes live. Cleared when a row leaves APPROVED. */
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /* ---- anti-spam / audit ---- */

    /**
     * SHA-256 of the submitter's IP and a server-side salt, never the address.
     *
     * Hashed because the only question this has to answer is "did these nine
     * submissions come from one place", which equality answers, and storing the
     * address itself would make every moderator's screen a place PII leaks from
     * for no additional capability. Null when no salt is configured — see
     * ReviewsService.
     */
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 255 }),

    ...timestamps,
  },
  (table) => [
    check("initial_reviews_rating_range", sql`${table.rating} between 1 and 5`),

    /* Approved and published-at are one fact, not two. Without this, a row can
       be live with a null sort key — which reads as "approved" in the queue and
       is invisible on the page it was approved for. */
    check(
      "initial_reviews_published_at_matches_status",
      sql`(${table.status} = 'APPROVED') = (${table.publishedAt} is not null)`,
    ),

    /* The public list and the featured strip: both read approved rows newest
       first, and the strip adds one equality on top. Partial, so a moderation
       backlog never bloats the index the storefront reads. */
    index("initial_reviews_published_idx")
      .on(table.isFeatured, table.publishedAt.desc())
      .where(sql`${table.status} = 'APPROVED'`),

    /* The moderation queue's default view. */
    index("initial_reviews_status_created_idx").on(table.status, table.createdAt.desc()),

    /* "Show me everything from whoever posted that" — the reason ipHash is
       stored at all. */
    index("initial_reviews_ip_hash_idx").on(table.ipHash),
  ],
);

export const initialReviewsRelations = relations(initialReviews, ({ one }) => ({
  order: one(orders, { fields: [initialReviews.orderId], references: [orders.id] }),
}));
