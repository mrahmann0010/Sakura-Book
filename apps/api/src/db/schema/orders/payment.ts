import { relations } from "drizzle-orm";
import { integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { paymentStatusEnum } from "../enums";
import { timestamps } from "../timestamps";
import { orders } from "./order";

export const payments = pgTable(
  "payments",
  {
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
  },
  (table) => [
    /**
     * Webhook idempotency, enforced by the database.
     *
     * Gateways retry. A replayed delivery of the same event carries the same
     * provider reference, and without this constraint it writes a second
     * payment row for one payment — which then double-counts in every total
     * read off this table. The handler relies on the 23505 rather than on
     * checking first, because a check-then-insert loses to a concurrent
     * redelivery, which is exactly what retries produce.
     */
    unique("payments_provider_reference_unique").on(table.provider, table.providerReferenceId),
  ],
);

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}));
