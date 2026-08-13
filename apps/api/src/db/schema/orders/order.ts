import { relations } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { orderStatusEnum } from "../enums";
import { coupons } from "../marketing/coupon";
import { timestamps } from "../timestamps";
import { orderItems } from "./order-item";
import { orderStatusHistory } from "./order-status-history";
import { payments } from "./payment";

export type ShippingAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: string;
};

export const orders = pgTable(
  "orders",
  {
    // Not sequential — this is the public lookup key.
    id: uuid("id").defaultRandom().primaryKey(),

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
