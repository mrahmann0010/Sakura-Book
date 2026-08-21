import { relations, sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { PaymentVerificationRecord } from "@sakura/contracts";
import {
  paymentMethodEnum,
  preOrderFulfillmentStatusEnum,
  preOrderPaymentStatusEnum,
} from "../enums";
import type { ShippingAddress } from "../orders/order";
import { timestamps } from "../timestamps";
import { preOrderBooks } from "./pre-order-book";

/**
 * A pre-order, single book + quantity per row — there is no line-items table
 * because a pre-order only ever has the one active title in it (see
 * pre-order-book.ts). That is the entire reason this table is simpler than
 * `orders`: no coupon, no shipping-cost ladder, no payment method — a
 * pre-order total is `unitPriceCents * quantity` and nothing else.
 *
 * Same snapshot discipline as `order_items`: book title/author/price are
 * frozen at the moment of the pre-order, not joined live, so a later edit to
 * the pre-order book (price, title) cannot rewrite a placed order.
 */
export const preOrderOrders = pgTable(
  "pre_order_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Mirrors orders.orderNumber — see orders/order-number.ts's generateOrderNumber,
    // reused as-is (see pre-orders/pre-order-number.ts).
    orderNumber: text("order_number").notNull().unique(),

    // Nullable: the pre-order book can be retired long after this order was placed.
    preOrderBookId: uuid("pre_order_book_id").references(() => preOrderBooks.id),
    bookTitleSnapshot: text("book_title_snapshot").notNull(),
    authorNameSnapshot: text("author_name_snapshot").notNull(),

    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    // unitPriceCents * quantity — no shipping, no coupon. Computed server-side,
    // always; see pre-orders/pre-order-checkout.service.ts.
    totalCents: integer("total_cents").notNull(),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>().notNull(),
    customerNote: text("customer_note"),

    // Reuses orders' payment_method enum rather than a second copy — see that
    // enum's comment. `cash-on-delivery` is a valid DB value but never chosen:
    // preOrderPaymentMethods in @sakura/contracts leaves it commented out, so
    // nothing upstream of this column can ever write it.
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    senderNumber: text("sender_number"),
    transactionId: text("transaction_id"),

    /**
     * Two tracks, not one — see the enums' comment. `payment_status` is the
     * acceptance decision a human makes after reading the transaction ID
     * above; `fulfillment_status` is where the parcel is, and stays
     * NOT_STARTED until there are printed copies to pick.
     *
     * The rule that ties them together — fulfilment cannot leave NOT_STARTED
     * unless payment is ACCEPTED — is enforced in pre-order-status.machine.ts
     * rather than by a CHECK constraint, so that the refusal arrives as a 422
     * naming the reason instead of a constraint-violation 500.
     */
    paymentStatus: preOrderPaymentStatusEnum("payment_status").notNull().default("PENDING"),
    fulfillmentStatus: preOrderFulfillmentStatusEnum("fulfillment_status")
      .notNull()
      .default("NOT_STARTED"),

    /**
     * What the last cross-check against the SMS payment gateway concluded —
     * outcome, when we looked, which wallet the receipt was found in, and the
     * amount that actually arrived. See PaymentVerificationRecord.
     *
     * One jsonb column rather than four typed ones because this is the record
     * of *a check*, not four independent facts: `paidCents` means nothing
     * without the outcome that interpreted it, and half the shape is absent
     * for half the outcomes. Nothing filters or sorts on it — the queue
     * filters on `payment_status`, which is what the check moves — so the
     * indexing argument for separate columns does not apply either.
     *
     * Null means never checked. That is distinct from a stored UNAVAILABLE,
     * which means we looked and could not reach the gateway.
     */
    paymentVerification: jsonb("payment_verification").$type<PaymentVerificationRecord>(),

    /** Staff-only scratchpad, same as orders.internalNote. Never sent to a customer. */
    internalNote: text("internal_note"),

    // Same double-submit guard as orders.idempotencyKey.
    idempotencyKey: text("idempotency_key").unique(),

    ...timestamps,
  },
  (table) => [
    index("pre_order_orders_created_idx").on(table.createdAt.desc(), table.id),
    // The queue's default view is "what needs verifying" — a filter on the
    // payment track, so that is the one that gets an index.
    index("pre_order_orders_payment_status_idx").on(table.paymentStatus),
    index("pre_order_orders_customer_email_idx").on(table.customerEmail),
    // Not a uniqueness constraint, deliberately — see
    // assertTransactionIdUnused in the pre-orders module for why the reuse
    // check is a query rather than an index. This exists to make that query,
    // which runs on every placement, a lookup rather than a scan.
    index("pre_order_orders_transaction_id_idx").on(table.transactionId),
    index("pre_order_orders_customer_name_trgm_idx").using(
      "gin",
      sql`${table.customerName} extensions.gin_trgm_ops`,
    ),
  ],
);

export const preOrderOrdersRelations = relations(preOrderOrders, ({ one }) => ({
  preOrderBook: one(preOrderBooks, {
    fields: [preOrderOrders.preOrderBookId],
    references: [preOrderBooks.id],
  }),
}));
