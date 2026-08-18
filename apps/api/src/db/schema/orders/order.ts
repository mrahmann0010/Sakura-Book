import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { orderStatusEnum, paymentMethodEnum } from "../enums";
import { coupons } from "../marketing/coupon";
import { timestamps } from "../timestamps";
import { orderItems } from "./order-item";
import { orderStatusHistory } from "./order-status-history";
import { payments } from "./payment";

/**
 * The address as the customer entered it, frozen.
 *
 * The fields are `shippingAddressSchema`'s in @sakura/contracts minus the three
 * that are columns on this table (name, email, phone) — those are indexed and
 * queried for order lookup, and a jsonb copy of an indexed column is a second
 * value that can disagree with the first.
 *
 * Not the generic line1/postalCode/country shape this started as: the shop
 * serves Bangladesh only, the form has no postcode field, and `region` is a
 * slug from the regions table that postage will eventually be priced off. An
 * international address model can be added the day there is an international
 * order to store in it.
 */
export type ShippingAddress = {
  address: string;
  city: string;
  /** Region slug, as sent — validated against the regions table at checkout. */
  region: string;
};

export const orders = pgTable(
  "orders",
  {
    // Not sequential, and never shown to a customer — see orderNumber.
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * The human-quotable id: eight characters, "MG-40718", exactly as the
     * confirmation copy promises and the design system's `OrderId` renders.
     *
     * A separate column rather than a formatted view of `id`, because it has to
     * be readable over the phone — and separate from a sequence, because a
     * guessable order number plus an email is the entire authentication of
     * /orders/lookup. Minted in application code with a uniqueness retry (see
     * orders/order-number.ts); the unique index here is what makes that retry
     * correct rather than hopeful.
     */
    orderNumber: text("order_number").notNull().unique(),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>().notNull(),

    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),

    // Both the FK and the snapshot are kept, deliberately. couponId answers
    // "which orders used this coupon" and ties the order to the row whose
    // timesUsed it incremented; the snapshot columns freeze what the customer
    // actually saw and was charged. Same principle as book price/title on
    // orderItems: never recompute discountCents from the live coupon row.
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    discountCodeSnapshot: text("discount_code_snapshot"), // the code as applied, e.g. "SAVE10"
    discountCents: integer("discount_cents").notNull().default(0),

    // subtotalCents + shippingCents - discountCents
    totalCents: integer("total_cents").notNull(),

    customerNote: text("customer_note"), // customer-facing: "gift wrap", "leave at gate", etc.
    internalNote: text("internal_note"), // staff-only: never shown to customer

    // Generated client-side (UUID) at checkout start, sent with the order-creation
    // request. Backend checks this before inserting a new order — prevents duplicate
    // orders/charges from double-clicks or network retries, which matters more here
    // since there's no account/order-history system to help a customer notice or
    // dispute a double charge.
    idempotencyKey: text("idempotency_key").unique(),

    // What the customer chose at checkout. Recorded on the order because COD
    // produces no payments row until delivery, so the payments table cannot
    // answer "how is this order being paid for" for the most common method.
    paymentMethod: paymentMethodEnum("payment_method").notNull(),

    // Denormalized "current status" for fast reads. The append-only log in
    // orderStatusHistory is the source of truth for how the order got here.
    status: orderStatusEnum("status").notNull().default("PENDING"),

    ...timestamps,
  },
  // Indexed for the Track Order lookup (order ID + email/phone), so this stays
  // fast as order volume grows rather than degrading to a full scan.
  (table) => [
    index("orders_customer_email_idx").on(table.customerEmail),
    index("orders_customer_phone_idx").on(table.customerPhone),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  coupon: one(coupons, { fields: [orders.couponId], references: [coupons.id] }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  payments: many(payments),
}));
