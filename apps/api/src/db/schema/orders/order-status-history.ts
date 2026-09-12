import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "../enums";
import { orders } from "./order";

/** Append-only audit log of order transitions. Rows are never updated. */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    status: orderStatusEnum("status").notNull(),
    note: text("note"), // e.g. tracking number when status = SHIPPED
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * "This order's history", which is every read this table has: the order
     * detail timeline, the relational `with: { statusHistory }` load, and the
     * dashboard's revenue recognition.
     *
     * A foreign key does not bring an index with it in Postgres — only the
     * referenced side is indexed, by its primary key — so until now every one
     * of those reads was a sequential scan of the whole audit log, a table
     * that only ever grows and is never pruned.
     *
     * `status` rides along so the dashboard's "when was this confirmed" can be
     * answered from the index alone rather than by visiting the heap for rows
     * it is about to discard; `createdAt` is the third column because both
     * callers want these in time order, and an index that already sorts them
     * saves the sort.
     */
    index("order_status_history_order_idx").on(table.orderId, table.status, table.createdAt),
  ],
);

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] }),
}));
