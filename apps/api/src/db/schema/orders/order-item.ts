import { relations } from "drizzle-orm";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { books } from "../catalog/book";
import { orders } from "./order";

export const orderItems = pgTable("order_items", {
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
  authorNamesSnapshot: text("author_names_snapshot").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
});

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  book: one(books, { fields: [orderItems.bookId], references: [books.id] }),
}));
