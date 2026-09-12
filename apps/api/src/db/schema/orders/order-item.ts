import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { books } from "../catalog/book";
import { orders } from "./order";

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    // Nullable: a book can be removed from the catalog long after it was sold,
    // and the order line has to survive that.
    bookId: uuid("book_id").references(() => books.id),

    // Book price/title/author snapshotted at time of order — never trust a live
    // join back to books/authors for historical orders.
    bookTitleSnapshot: text("book_title_snapshot").notNull(),
    // jsonb rather than a joined string: the API returns `authors: string[]` and
    // a book can have several. Storing "Ana Ruiz, Hiroshi Tanabe" would mean
    // splitting on a comma to read it back, which silently mangles the first
    // author whose own name contains one. The column was always plural.
    authorNamesSnapshot: jsonb("author_names_snapshot").$type<string[]>().notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    /**
     * "The lines on this order" — the order detail screen, the receipt PDF,
     * and the dashboard's copy counts. Unindexed until now for the same reason
     * as the status log: the foreign key indexes `orders.id`, not this column.
     */
    index("order_items_order_idx").on(table.orderId),
    /**
     * "Every line that sold this title", which is what a per-period units
     * figure needs — and what UnitsSoldReconciler already walks to put
     * `books.units_sold` back in step with the order lines.
     */
    index("order_items_book_idx").on(table.bookId),
  ],
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  book: one(books, { fields: [orderItems.bookId], references: [books.id] }),
}));
