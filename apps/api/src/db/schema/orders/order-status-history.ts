import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "../enums";
import { orders } from "./order";

/** Append-only audit log of order transitions. Rows are never updated. */
export const orderStatusHistory = pgTable("order_status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  status: orderStatusEnum("status").notNull(),
  note: text("note"), // e.g. tracking number when status = SHIPPED
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderStatusHistoryRelations = relations(orderStatusHistory, ({ one }) => ({
  order: one(orders, { fields: [orderStatusHistory.orderId], references: [orders.id] }),
}));
