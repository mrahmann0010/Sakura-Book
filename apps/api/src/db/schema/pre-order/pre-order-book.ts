import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";
import { preOrderOrders } from "./pre-order-order";

/**
 * The book being pre-sold. One title at a time is the actual shape of the
 * feature — the catalog card only ever shows the *active* one — but the table
 * has no uniqueness constraint enforcing that, on the same reasoning as
 * `books.isActive`: it is a display filter, not an invariant the schema owns.
 *
 * `authorName` is a plain string rather than a join through `book_authors`,
 * unlike the real catalog: a pre-order book has no ISBN, no publisher, and no
 * reviews either — it is a lightweight standalone row, not a `books` row that
 * merely lacks stock yet.
 */
export const preOrderBooks = pgTable(
  "pre_order_books",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    authorName: text("author_name").notNull(),
    description: text("description").notNull(),
    pageCount: integer("page_count"),
    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    coverImageUrl: text("cover_image_url").notNull(),
    coverImageAlt: text("cover_image_alt"),

    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (table) => [
    // The public `/pre-order-books/active` read: one row, filtered by this.
    index("pre_order_books_active_idx").on(table.isActive),
  ],
);

export const preOrderBooksRelations = relations(preOrderBooks, ({ many }) => ({
  orders: many(preOrderOrders),
}));
