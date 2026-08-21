import { relations, sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { preOrderStatusEnum } from "../enums";
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

    status: preOrderStatusEnum("status").notNull().default("PENDING"),

    // Same double-submit guard as orders.idempotencyKey.
    idempotencyKey: text("idempotency_key").unique(),

    ...timestamps,
  },
  (table) => [
    index("pre_order_orders_created_idx").on(table.createdAt.desc(), table.id),
    index("pre_order_orders_customer_email_idx").on(table.customerEmail),
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
