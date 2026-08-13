import { relations } from "drizzle-orm";
import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { paymentStatusEnum } from "../enums";
import { timestamps } from "../timestamps";
import { orders } from "./order";

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),

  provider: text("provider").notNull(), // e.g. "stripe", "sslcommerz" — abstracted, swappable
  providerReferenceId: text("provider_reference_id").notNull(), // the gateway's own transaction/session ID
  amountCents: integer("amount_cents").notNull(),
  status: paymentStatusEnum("status").notNull().default("PENDING"),
  rawResponse: jsonb("raw_response"), // gateway payload, kept for debugging without schema churn

  ...timestamps,
});

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
