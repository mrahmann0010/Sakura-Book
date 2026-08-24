import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { paymentProviderEnum, paymentVerificationOutcomeEnum } from "../enums";
import { timestamps } from "../timestamps";
import { orders } from "./order";

/* --------------------------------------------------------------------------
   Every cross-check of a receipt against the payment gateway, kept.

   Before this table a verification was computed, rendered once, and lost: the
   admin panel showed the outcome until the page was refreshed and nothing
   anywhere recorded that anyone had looked. Three things were impossible as a
   result — telling which orders had been confirmed without a check, showing a
   verification state in the queue without re-asking the gateway for every row,
   and answering "who verified this, and what did it say at the time" months
   later when a customer disputes a delivery.

   Append-only, like orderStatusHistory and for the same reason: "not found at
   09:12, found at 11:40" is the actual story of a manual transfer, and a
   single mutable column on `orders` would keep only the last frame of it. SMS
   arrive late, so the first check being NOT_FOUND is normal rather than
   suspicious, and flattening that away would make it look suspicious.
   -------------------------------------------------------------------------- */

export const paymentVerifications = pgTable(
  "payment_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),

    outcome: paymentVerificationOutcomeEnum("outcome").notNull(),

    /**
     * The receipt as it was checked, normalised.
     *
     * Copied onto the row rather than joined back to `orders.transaction_id`,
     * because this is a record of what was checked at the time. If the receipt
     * on the order is ever corrected, the history must still say which value
     * produced which answer.
     */
    transactionIdNormalised: text("transaction_id_normalised").notNull(),

    provider: paymentProviderEnum("provider"),

    /* Nullable per outcome, matching paymentVerificationRecordSchema: there is
       no amount for a receipt that was never found, and none for a gateway
       that could not be reached. */
    paidCents: integer("paid_cents"),
    expectedCents: integer("expected_cents"),
    receivedAt: timestamp("received_at", { withTimezone: true }),

    /** Only on UNAVAILABLE — why the lookup could not happen. */
    reason: text("reason"),

    /**
     * Who asked. Null for the automatic check that runs at checkout, which is
     * the distinction that matters when reading the history back: a machine
     * looking is routine, a named person looking is a decision.
     *
     * Deliberately not a foreign key to admin_users — the email is the durable
     * record. Staff leave and their row may be removed; what they verified
     * must not become anonymous when that happens.
     */
    checkedByEmail: text("checked_by_email"),

    /** The gateway's own payload, kept verbatim for disputes. */
    raw: jsonb("raw"),

    ...timestamps,
  },
  (table) => [
    /* "What is the story of this order's payment?" — read newest-first, which
       is how the panel renders it and how the latest-outcome lookup for the
       queue badge finds its row without sorting the whole table. */
    index("payment_verifications_order_idx").on(table.orderId, table.createdAt.desc()),
  ],
);

export const paymentVerificationsRelations = relations(paymentVerifications, ({ one }) => ({
  order: one(orders, { fields: [paymentVerifications.orderId], references: [orders.id] }),
}));
