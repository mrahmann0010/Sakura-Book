import { boolean, check, index, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { timestamps } from "../timestamps";
import { books } from "./book";

/**
 * Customer reviews of a specific book.
 *
 * The `rating` / `ratingCount` fields on the catalog contract have been
 * nullable-and-unbacked since the contract was written; this is the table that
 * backs them. Note what follows from that: **there is no review data yet**, so
 * every book's aggregate is legitimately null until someone writes one. That is
 * the intended state, not a gap to fill with seeded averages — PRODUCT.md is
 * explicit that no review, star average or count may be shown as real until
 * real data backs it, and a seeded 4.5 is exactly the thing it forbids.
 *
 * The aggregate is computed at read time rather than denormalised onto `books`.
 * `units_sold` is denormalised because checkout must not block on a count;
 * a rating average is read on a page that is already doing a join, over a
 * catalog measured in dozens of titles, so the rollup column would buy nothing
 * and add a second thing that can drift.
 *
 * `isPublished` exists because the shop is curated and a review appears under
 * its name. Unpublished rows are invisible to the storefront and excluded from
 * the aggregate — moderation must not be able to change a displayed average
 * without changing what is displayed alongside it.
 */
export const bookReviews = pgTable(
  "book_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id),

    /** Whole stars, 1-5. Halves are a presentation concern of the average. */
    rating: integer("rating").notNull(),

    /** As the reviewer asked to be credited. There are no accounts to join to. */
    reviewerName: text("reviewer_name").notNull(),
    title: text("title"),
    body: text("body"),

    /** Set when the review is tied to a real order line. Null for imported ones. */
    orderNumber: varchar("order_number", { length: 32 }),

    isPublished: boolean("is_published").notNull().default(false),

    ...timestamps,
  },
  (table) => [
    check("book_reviews_rating_range", sql`${table.rating} between 1 and 5`),
    // The storefront only ever reads published reviews for one book, and the
    // aggregate does the same. Partial, so moderation queues don't bloat it.
    index("book_reviews_book_published_idx")
      .on(table.bookId)
      .where(sql`${table.isPublished}`),
  ],
);

export const bookReviewsRelations = relations(bookReviews, ({ one }) => ({
  book: one(books, { fields: [bookReviews.bookId], references: [books.id] }),
}));
